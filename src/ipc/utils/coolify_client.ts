import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("coolify_client");

import { COOLIFY_REQUIRED_SCOPES } from "@/shared/coolify_scopes";
import {
  CoolifyProjectSchema,
  CoolifyServerSchema,
  type CoolifyProjectInfo,
  type CoolifyServerInfo,
} from "@/ipc/types/coolify";

export interface CoolifyClientOptions {
  instanceUrl: string;
  token: string;
  /** Aborts in-flight requests when the work that started them is abandoned. */
  signal?: AbortSignal;
}

/** No Coolify call is slow by design; without this a dead host hangs forever. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface CoolifyApplication {
  uuid: string;
  name?: string;
  fqdn?: string | null;
  private_key_id?: number | null;
}

export interface CoolifyDeployment {
  deployment_uuid?: string;
  status?: string;
  logs?: string;
}

export type CoolifyServer = CoolifyServerInfo;
export type CoolifyProject = CoolifyProjectInfo;

/** Carries the HTTP status so callers can branch on 404 and 409. */
class CoolifyRequestError extends DyadError {
  readonly status: number;

  constructor(message: string, kind: DyadErrorKind, status: number) {
    super(message, kind);
    this.name = "CoolifyRequestError";
    this.status = status;
  }
}

export function isCoolifyStatus(error: unknown, status: number): boolean {
  return error instanceof CoolifyRequestError && error.status === status;
}

/**
 * How an application should be built and served.
 *
 * A Vite app without a Nitro server layer compiles to static files with no
 * process to run, so a build pack alone has nothing to start and the container
 * exits. Those pair a build pack with `isStatic`, which serves the built output
 * with nginx — not Coolify's `static` build pack, which skips the build. See
 * buildConfigForFramework.
 */
export interface CoolifyBuildConfig {
  buildPack: "nixpacks" | "railpack";
  portsExposes: string;
  isStatic: boolean;
  /** Rewrites unknown paths to index.html so client-side routes resolve. */
  isSpa: boolean;
  publishDirectory?: string;
  /**
   * How to run the built app, for frameworks whose build output is not
   * runnable through a package.json script. Omitted for static sites, which
   * nginx serves with no process at all.
   */
  startCommand?: string;
}

export class CoolifyClient {
  private readonly base: string;

  constructor(private readonly options: CoolifyClientOptions) {
    this.base = options.instanceUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    let text: string;
    // Chromium's fetch has no default timeout, so an instance that accepts the
    // connection and then goes quiet would otherwise park the deploy forever.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, timeout])
      : timeout;
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        method,
        signal,
        // Electron's main-process fetch is Chromium-backed and would otherwise
        // attach cookies from the default session. Coolify's own session
        // cookie is large enough that the proxy in front of it rejects the
        // request before Coolify ever sees it, and this call authenticates
        // with a bearer token so cookies are never wanted.
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw this.transportError(err);
    }

    // Reading the body can stall after the headers arrive, so it shares the
    // request's cancellation and timeout handling rather than surfacing a bare
    // AbortError.
    try {
      text = await res.text();
    } catch (err) {
      throw this.transportError(err);
    }

    if (!res.ok) {
      throw this.toError(method, path, res.status, text);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // A proxy or login page answering 200 with HTML would otherwise be cast
      // to the expected type, and the caller would read undefined fields
      // instead of learning the instance is not answering as Coolify.
      throw new DyadError(
        `Coolify returned a response that is not JSON for ${path}. The address ` +
          `may be reaching something else, such as a proxy or a login page.`,
        DyadErrorKind.External,
      );
    }
  }

  /** Cancellation, timeout and unreachable-host failures, classified alike. */
  private transportError(err: unknown): DyadError {
    if (this.options.signal?.aborted) {
      return new DyadError(
        "Deployment cancelled.",
        DyadErrorKind.UserCancelled,
      );
    }
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return new DyadError(
      `Could not reach Coolify at ${this.base}: ${
        timedOut
          ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err)
      }`,
      DyadErrorKind.External,
    );
  }

  /** Bearer tokens are short; anything long means we are sending the wrong value. */
  private tokenLooksWrong(): boolean {
    return this.options.token.length > 400;
  }

  private toError(
    method: string,
    path: string,
    status: number,
    text: string,
  ): DyadError {
    const detail = text.slice(0, 300);
    if (/Header Or Cookie Too Large/i.test(text)) {
      // Log the sizes rather than the values so this is diagnosable.
      logger.error(
        `Coolify rejected an oversized request header. ` +
          `url=${this.base}/api/v1${path} tokenChars=${this.options.token.length}`,
      );
      return new CoolifyRequestError(
        `The Coolify server rejected the request because its headers were too large` +
          (this.tokenLooksWrong()
            ? `. The stored API token is ${this.options.token.length} characters, which is far longer than a Coolify token — try disconnecting and pasting it again.`
            : `. The API token looks a normal length (${this.options.token.length} characters), so the request is being enlarged elsewhere; check whether the instance sits behind a proxy that adds headers.`),
        DyadErrorKind.External,
        status,
      );
    }
    if (status === 401) {
      return new CoolifyRequestError(
        "Coolify rejected the API token. Check that it is correct and has not been revoked.",
        DyadErrorKind.Auth,
        status,
      );
    }
    if (status === 403) {
      // Coolify's API is switched off by default and its own auth runs first,
      // so this only appears once the token itself is accepted.
      if (/API is disabled/i.test(text)) {
        return new CoolifyRequestError(
          "This Coolify instance has its API switched off. Enable it in Coolify " +
            "under Settings → Advanced → API Access, then try again.",
          DyadErrorKind.Precondition,
          status,
        );
      }
      return new CoolifyRequestError(
        `Coolify rejected the request for lack of permissions. The API token ` +
          `needs all of: ${COOLIFY_REQUIRED_SCOPES}. Scopes are fixed when a token is ` +
          `created, so create a new token with all of them.`,
        DyadErrorKind.Auth,
        status,
      );
    }
    if (status === 404) {
      return new CoolifyRequestError(
        `Coolify could not find the requested resource (${path}).`,
        DyadErrorKind.NotFound,
        status,
      );
    }
    if (status === 429) {
      // Throttling is the user's instance asking for a pause, not a crash.
      return new CoolifyRequestError(
        "Coolify is rate limiting requests. Wait a moment and try again.",
        DyadErrorKind.RateLimited,
        status,
      );
    }
    logger.error(`Coolify ${method} ${path} -> ${status}: ${detail}`);
    return new CoolifyRequestError(
      `Coolify request failed (${status}): ${detail}`,
      DyadErrorKind.External,
      status,
    );
  }

  /** Validates the token and returns the reachable servers. */
  async listServers(): Promise<CoolifyServer[]> {
    return this.requestList("/servers", CoolifyServerSchema, "servers");
  }

  async listProjects(): Promise<CoolifyProject[]> {
    return this.requestList("/projects", CoolifyProjectSchema, "projects");
  }

  /**
   * Fetches a list and checks it is the shape we expect.
   *
   * Coolify is self-hosted, so the instance can be any version. Casting the
   * response meant a renamed field or a wrapped payload produced an empty
   * picker and a permanently disabled Save with nothing to act on, rather
   * than saying the instance answered with something we do not understand.
   */
  private async requestList<T>(
    path: string,
    schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
    what: string,
  ): Promise<T[]> {
    const body = await this.request<unknown>("GET", path);
    if (!Array.isArray(body)) {
      throw new DyadError(
        `Coolify did not return a list of ${what}. This instance may be a ` +
          `version Dyad does not understand.`,
        DyadErrorKind.External,
      );
    }
    const parsed: T[] = [];
    for (const item of body) {
      const result = schema.safeParse(item);
      // One odd entry should not cost the user the rest of the list: they can
      // still pick a server that did parse. Only a list with nothing usable
      // in it means we are talking to something we do not understand.
      if (!result.success || result.data === undefined) {
        logger.warn(`Skipped a Coolify ${what} entry in an unexpected shape.`);
        continue;
      }
      parsed.push(result.data);
    }
    if (parsed.length === 0 && body.length > 0) {
      throw new DyadError(
        `Coolify returned ${what} in an unexpected shape. This instance may ` +
          `be a version Dyad does not understand.`,
        DyadErrorKind.External,
      );
    }
    return parsed;
  }

  async createProject(name: string): Promise<{ uuid: string }> {
    return this.request("POST", "/projects", { name });
  }

  /**
   * Registers a private key so Coolify can clone a private repository.
   *
   * Returns the numeric id as well, because an application records the key it
   * clones with as `private_key_id` and there is no way to change it later.
   * A failed lookup propagates rather than being read as "no keys", which
   * would create a duplicate and leave the application on an unknown key.
   */
  async registerPrivateKey({
    name,
    privateKey,
    description,
  }: {
    name: string;
    privateKey: string;
    description?: string;
  }): Promise<{ uuid: string; id: number | null }> {
    const listKeys = async () => {
      const keys = await this.request<
        Array<{ uuid: string; name: string; id?: number }>
      >("GET", "/security/keys");
      return Array.isArray(keys) ? keys : [];
    };

    const existing = await listKeys();
    const match = existing.find((k) => k.name === name);
    if (match) return { uuid: match.uuid, id: match.id ?? null };

    const created = await this.request<{ uuid: string }>(
      "POST",
      "/security/keys",
      { name, description, private_key: privateKey },
    );
    // The create response carries no id, so read it back.
    const after = await listKeys();
    const found = after.find((k) => k.uuid === created.uuid);
    return { uuid: created.uuid, id: found?.id ?? null };
  }

  async createApplicationFromPrivateRepo(params: {
    serverUuid: string;
    projectUuid: string;
    environmentName: string;
    privateKeyUuid: string;
    gitRepository: string;
    gitBranch: string;
    name: string;
    build: CoolifyBuildConfig;
    domains?: string | null;
  }): Promise<{ uuid: string }> {
    return this.request("POST", "/applications/private-deploy-key", {
      server_uuid: params.serverUuid,
      project_uuid: params.projectUuid,
      environment_name: params.environmentName,
      private_key_uuid: params.privateKeyUuid,
      git_repository: params.gitRepository,
      git_branch: params.gitBranch,
      name: params.name,
      build_pack: params.build.buildPack,
      ports_exposes: params.build.portsExposes,
      is_static: params.build.isStatic,
      is_spa: params.build.isSpa,
      publish_directory: params.build.publishDirectory,
      start_command: params.build.startCommand,
      domains: params.domains ?? undefined,
      // Without a domain Coolify generates an sslip.io address from the
      // server's IP, which needs no DNS setup but is HTTP only.
      autogenerate_domain: !params.domains,
      instant_deploy: false,
    });
  }

  /**
   * Patches an application.
   *
   * `domains` is only sent when present in the patch. Omitting it leaves
   * whatever Coolify has, which matters because an application created without
   * a domain was given a generated one, and `autogenerate_domain` cannot be
   * set on update — so blanking the field here would strip the address with no
   * way to ask for another. Pass `null` to deliberately clear it.
   */
  async updateApplication(
    uuid: string,
    patch: {
      domains?: string | null;
      build?: CoolifyBuildConfig;
      source?: { gitRepository: string; gitBranch: string };
    },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.domains !== undefined) {
      body.domains = patch.domains ?? "";
    }
    // An application keeps whatever repository and branch it was created with,
    // so without this a redeploy after switching branches builds the old one.
    if (patch.source) {
      body.git_repository = patch.source.gitRepository;
      body.git_branch = patch.source.gitBranch;
    }
    if (patch.build) {
      body.build_pack = patch.build.buildPack;
      body.ports_exposes = patch.build.portsExposes;
      body.is_static = patch.build.isStatic;
      body.is_spa = patch.build.isSpa;
      // Both sent even when absent, so a framework change clears whichever the
      // previous shape left behind rather than keeping a stale one.
      body.publish_directory = patch.build.publishDirectory ?? "";
      body.start_command = patch.build.startCommand ?? "";
    }
    await this.request("PATCH", `/applications/${uuid}`, body);
  }

  async getApplication(uuid: string): Promise<CoolifyApplication> {
    return this.request("GET", `/applications/${uuid}`);
  }

  /**
   * Sets an environment variable, updating it when it already exists.
   *
   * `is_literal` stops Coolify interpolating a `$` that can appear in a
   * database password. Only a 409 means "already present" — every other
   * failure propagates rather than being retried as an update, which could
   * overwrite a value after an ambiguous create.
   */
  async setEnv(
    applicationUuid: string,
    key: string,
    value: string,
  ): Promise<void> {
    const body = { key, value, is_preview: false, is_literal: true };
    try {
      await this.request("POST", `/applications/${applicationUuid}/envs`, body);
    } catch (error) {
      if (!isCoolifyStatus(error, 409)) throw error;
      await this.request(
        "PATCH",
        `/applications/${applicationUuid}/envs`,
        body,
      );
    }
  }

  async startApplication(uuid: string): Promise<CoolifyDeployment> {
    return this.request("POST", `/applications/${uuid}/start`, {});
  }

  /**
   * Reads a deployment's status.
   *
   * Note this uses `/deployments/{uuid}`. The similarly named
   * `/deployments/applications/{uuid}` returns Application objects, which carry
   * no deployment status at all.
   */
  async getDeployment(deploymentUuid: string): Promise<CoolifyDeployment> {
    return this.request("GET", `/deployments/${deploymentUuid}`);
  }

  async deleteApplication(uuid: string): Promise<void> {
    await this.request("DELETE", `/applications/${uuid}`);
  }
}
