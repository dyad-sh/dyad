import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("gitlab_client");

/**
 * A thin client for the GitLab REST API (v4), for gitlab.com and self-hosted
 * instances alike. The instance URL may carry a path prefix (a GitLab served
 * under a relative URL root), so every request is built from it verbatim.
 */

export interface GitLabClientOptions {
  instanceUrl: string;
  token: string;
  /** Aborts in-flight requests when the work that started them is abandoned. */
  signal?: AbortSignal;
}

/** Nothing here is slow by design; without this a dead host hangs forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How many pages a listing follows before it stops. */
const MAX_PAGES = 10;

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  namespaceId: number | null;
}

export interface GitLabTokenInfo {
  scopes: string[];
  expiresAt: string | null;
  active: boolean;
}

export interface GitLabNamespace {
  id: number;
  /** `group/subgroup` for a group, the username for a personal namespace. */
  fullPath: string;
  kind: "user" | "group";
  name: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  /** The last path segment, e.g. `my-app`. */
  path: string;
  /** `namespace/path`, what a user recognises the project by. */
  pathWithNamespace: string;
  defaultBranch: string | null;
  visibility: string;
  sshUrlToRepo: string;
  httpUrlToRepo: string;
  webUrl: string;
}

export interface GitLabBranch {
  name: string;
  commit: { id: string };
}

export interface GitLabDeployKey {
  id: number;
  title: string;
  key: string;
  canPush: boolean;
}

/** Carries the HTTP status so callers can branch on 404 and 400. */
class GitLabRequestError extends DyadError {
  readonly status: number;

  constructor(message: string, kind: DyadErrorKind, status: number) {
    super(message, kind);
    this.name = "GitLabRequestError";
    this.status = status;
  }
}

export function isGitLabStatus(error: unknown, status: number): boolean {
  return error instanceof GitLabRequestError && error.status === status;
}

/** The scope a token needs for everything Dyad does: projects, groups, deploy keys, git. */
export const GITLAB_REQUIRED_SCOPE = "api";

/**
 * GitLab reports validation failures as `{ message: { field: ["reason"] } }`
 * and everything else as `{ message: "..." }` or `{ error: "..." }`. Flatten
 * whichever arrived into one line a user can read.
 */
export function describeGitLabError(text: string, status: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.trim() || `HTTP ${status}`;
  }
  if (!parsed || typeof parsed !== "object") return `HTTP ${status}`;
  const body = parsed as { message?: unknown; error?: unknown };
  const message = body.message ?? body.error;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    const parts = Object.entries(message as Record<string, unknown>).map(
      ([field, reasons]) => {
        const list = Array.isArray(reasons) ? reasons.join(", ") : reasons;
        return `${field} ${String(list)}`;
      },
    );
    if (parts.length > 0) return parts.join("; ");
  }
  return `HTTP ${status}`;
}

export class GitLabClient {
  private readonly base: string;

  constructor(private readonly options: GitLabClientOptions) {
    this.base = options.instanceUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; nextPage: string | null }> {
    let res: Response;
    let text: string;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, timeout])
      : timeout;
    try {
      res = await fetch(`${this.base}/api/v4${path}`, {
        method,
        signal,
        // The main-process fetch is Chromium-backed and would attach cookies
        // from the default session; the token header is the only credential
        // wanted here.
        credentials: "omit",
        headers: {
          // The header form every GitLab version accepts for a personal access
          // token; `Authorization: Bearer` only arrived later.
          "PRIVATE-TOKEN": this.options.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw this.transportError(err);
    }

    try {
      text = await res.text();
    } catch (err) {
      throw this.transportError(err);
    }

    if (!res.ok) {
      throw this.toError(method, path, res.status, text);
    }
    const nextPage = res.headers.get("x-next-page") || null;
    if (!text) return { data: undefined as T, nextPage };
    try {
      return { data: JSON.parse(text) as T, nextPage };
    } catch {
      throw new DyadError(
        `GitLab answered ${method} ${path} with something that is not JSON. ` +
          "Check that the address points at a GitLab instance.",
        DyadErrorKind.External,
      );
    }
  }

  private transportError(err: unknown): DyadError {
    if (this.options.signal?.aborted) {
      throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
    }
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err);
    return new DyadError(
      `Could not reach GitLab at ${this.base}: ${reason}`,
      DyadErrorKind.External,
    );
  }

  private toError(
    method: string,
    path: string,
    status: number,
    text: string,
  ): GitLabRequestError {
    const detail = describeGitLabError(text, status);
    logger.warn(`GitLab ${method} ${path} -> ${status}: ${detail}`);
    if (status === 401) {
      return new GitLabRequestError(
        "GitLab rejected the access token. It may have expired or been revoked; reconnect GitLab with a new token.",
        DyadErrorKind.Auth,
        status,
      );
    }
    if (status === 403) {
      return new GitLabRequestError(
        `GitLab refused the request: ${detail}. The token may be missing the ${GITLAB_REQUIRED_SCOPE} scope, or the account lacks access.`,
        DyadErrorKind.Auth,
        status,
      );
    }
    if (status === 404) {
      return new GitLabRequestError(
        `GitLab could not find ${path}: ${detail}`,
        DyadErrorKind.NotFound,
        status,
      );
    }
    if (status >= 400 && status < 500) {
      return new GitLabRequestError(
        `GitLab rejected the request: ${detail}`,
        DyadErrorKind.Validation,
        status,
      );
    }
    return new GitLabRequestError(
      `GitLab returned ${status} for ${method} ${path}: ${detail}`,
      DyadErrorKind.External,
      status,
    );
  }

  /** Every page of a listing, up to a sane cap. */
  private async listAll<T>(path: string): Promise<T[]> {
    const separator = path.includes("?") ? "&" : "?";
    const items: T[] = [];
    let page: string | null = "1";
    for (let count = 0; page && count < MAX_PAGES; count++) {
      const result: { data: T[]; nextPage: string | null } = await this.request<
        T[]
      >("GET", `${path}${separator}per_page=100&page=${page}`);
      items.push(...result.data);
      page = result.nextPage;
    }
    return items;
  }

  async getCurrentUser(): Promise<GitLabUser> {
    const { data } = await this.request<{
      id: number;
      username: string;
      name?: string;
      email?: string | null;
      namespace_id?: number | null;
    }>("GET", "/user");
    return {
      id: data.id,
      username: data.username,
      name: data.name ?? data.username,
      email: data.email ?? null,
      namespaceId: data.namespace_id ?? null,
    };
  }

  /**
   * What the token can do and when it stops working, or null on an instance
   * too old to answer (the endpoint arrived in GitLab 16.0).
   */
  async getTokenInfo(): Promise<GitLabTokenInfo | null> {
    try {
      const { data } = await this.request<{
        scopes?: string[];
        expires_at?: string | null;
        active?: boolean;
      }>("GET", "/personal_access_tokens/self");
      return {
        scopes: data.scopes ?? [],
        expiresAt: data.expires_at ?? null,
        active: data.active ?? true,
      };
    } catch (err) {
      if (isGitLabStatus(err, 404)) return null;
      throw err;
    }
  }

  /**
   * Groups the user can create projects in. Developer is GitLab's default
   * floor for creating projects in a group, so that is the floor here.
   */
  async listGroups(): Promise<GitLabNamespace[]> {
    const groups = await this.listAll<{
      id: number;
      full_path: string;
      name: string;
    }>("/groups?min_access_level=30&order_by=path&sort=asc");
    return groups.map((group) => ({
      id: group.id,
      fullPath: group.full_path,
      kind: "group" as const,
      name: group.name,
    }));
  }

  /**
   * The user's personal namespace, for an instance old enough that GET /user
   * does not report `namespace_id`. Empty when the search finds nothing.
   */
  async findUserNamespace(username: string): Promise<GitLabNamespace[]> {
    const { data } = await this.request<
      Array<{ id: number; full_path: string; kind: string; name: string }>
    >("GET", `/namespaces?search=${encodeURIComponent(username)}&per_page=50`);
    return data
      .filter((ns) => ns.kind === "user" && ns.full_path === username)
      .map((ns) => ({
        id: ns.id,
        fullPath: ns.full_path,
        kind: "user" as const,
        name: ns.name,
      }));
  }

  /**
   * Projects the user is a Maintainer of, most recently active first. GitLab
   * protects the default branch so that only Maintainers push to it; listing
   * from that level up means "connect and push" works on the first try.
   */
  async listProjects(): Promise<GitLabProject[]> {
    const projects = await this.listAll<RawProject>(
      "/projects?membership=true&min_access_level=40&order_by=last_activity_at&sort=desc&archived=false",
    );
    return projects.map(toProject);
  }

  /** Looks a project up by numeric id or by `namespace/path`. */
  async getProject(idOrPath: number | string): Promise<GitLabProject> {
    const { data } = await this.request<RawProject>(
      "GET",
      `/projects/${encodeProjectRef(idOrPath)}`,
    );
    return toProject(data);
  }

  async createProject({
    name,
    path,
    namespaceId,
  }: {
    name: string;
    path: string;
    namespaceId: number;
  }): Promise<GitLabProject> {
    const { data } = await this.request<RawProject>("POST", "/projects", {
      name,
      path,
      namespace_id: namespaceId,
      visibility: "private",
      initialize_with_readme: false,
    });
    return toProject(data);
  }

  async listBranches(projectId: number): Promise<GitLabBranch[]> {
    const branches = await this.listAll<{
      name: string;
      commit?: { id?: string };
    }>(`/projects/${projectId}/repository/branches`);
    return branches.map((branch) => ({
      name: branch.name,
      commit: { id: branch.commit?.id ?? "" },
    }));
  }

  async listDeployKeys(projectId: number): Promise<GitLabDeployKey[]> {
    const keys = await this.listAll<RawDeployKey>(
      `/projects/${projectId}/deploy_keys`,
    );
    return keys.map(toDeployKey);
  }

  /** Adds a read-only deploy key to the project. */
  async addDeployKey(
    projectId: number,
    { title, key }: { title: string; key: string },
  ): Promise<GitLabDeployKey> {
    const { data } = await this.request<RawDeployKey>(
      "POST",
      `/projects/${projectId}/deploy_keys`,
      { title, key, can_push: false },
    );
    return toDeployKey(data);
  }
}

interface RawProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  default_branch?: string | null;
  visibility?: string;
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  web_url: string;
}

function toProject(raw: RawProject): GitLabProject {
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    pathWithNamespace: raw.path_with_namespace,
    defaultBranch: raw.default_branch ?? null,
    visibility: raw.visibility ?? "private",
    sshUrlToRepo: raw.ssh_url_to_repo,
    httpUrlToRepo: raw.http_url_to_repo,
    webUrl: raw.web_url,
  };
}

interface RawDeployKey {
  id: number;
  title: string;
  key: string;
  can_push?: boolean;
}

function toDeployKey(raw: RawDeployKey): GitLabDeployKey {
  return {
    id: raw.id,
    title: raw.title,
    key: raw.key,
    canPush: raw.can_push ?? false,
  };
}

/** GitLab addresses a project by id or by its URL-encoded full path. */
export function encodeProjectRef(idOrPath: number | string): string {
  return typeof idOrPath === "number"
    ? String(idOrPath)
    : encodeURIComponent(idOrPath);
}
