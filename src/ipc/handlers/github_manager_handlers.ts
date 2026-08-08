import { writeSettings } from "../../main/settings";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { githubContracts } from "../types/github";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { normalizeGitHubRepoName } from "./github_handlers";
import {
  fetchGithubAccount,
  GITHUB_API_BASE,
  githubApiFetch,
  githubApiJson,
  parseRepoFullName,
} from "../utils/github_api_utils";

const logger = log.scope("github_manager_handlers");

function mapRepo(repo: {
  name: string;
  full_name: string;
  private: boolean;
  owner?: { login?: string };
  default_branch?: string;
}) {
  const { owner } = parseRepoFullName(repo.full_name);
  return {
    name: repo.name,
    full_name: repo.full_name,
    owner: repo.owner?.login ?? owner,
    private: repo.private,
    default_branch: repo.default_branch,
  };
}

async function handleSetAccessToken({
  token,
}: {
  token: string;
}): Promise<{ login: string; email: string }> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new DyadError(
      "Personal access token cannot be empty.",
      DyadErrorKind.Validation,
    );
  }

  const headers = {
    Authorization: `Bearer ${trimmed}`,
    Accept: "application/vnd.github+json",
  };
  const userRes = await fetch(`${GITHUB_API_BASE}/user`, { headers });
  if (!userRes.ok) {
    throw new DyadError(
      "Invalid GitHub token. Check the token and required scopes (repo).",
      DyadErrorKind.Auth,
    );
  }
  const user = (await userRes.json()) as { login: string };

  let email = "";
  try {
    const emailsRes = await fetch(`${GITHUB_API_BASE}/user/emails`, {
      headers,
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email?: string;
        primary?: boolean;
      }>;
      email = emails.find((e) => e.primary)?.email ?? emails[0]?.email ?? "";
    }
  } catch {
    // optional
  }

  writeSettings({
    githubAccessToken: { value: trimmed },
    githubUser: {
      email: email || `${user.login}@users.noreply.github.com`,
      login: user.login,
    },
  });

  return {
    login: user.login,
    email: email || `${user.login}@users.noreply.github.com`,
  };
}

async function handleGetAccount(): Promise<{
  login: string;
  email: string;
} | null> {
  try {
    return await fetchGithubAccount();
  } catch (err) {
    if (err instanceof DyadError && err.kind === DyadErrorKind.Auth) {
      return null;
    }
    throw err;
  }
}

async function handleCreateManagerRepo({
  name,
  private: isPrivate = true,
  description,
}: {
  name: string;
  private?: boolean;
  description?: string;
}): Promise<ReturnType<typeof mapRepo>> {
  const normalizedRepo = normalizeGitHubRepoName(name);
  const repo = await githubApiJson<{
    name: string;
    full_name: string;
    private: boolean;
    owner: { login: string };
    default_branch?: string;
  }>("/user/repos", {
    method: "POST",
    body: {
      name: normalizedRepo,
      private: isPrivate,
      description: description?.trim() || undefined,
      auto_init: true,
    },
  });
  return mapRepo(repo);
}

async function handleDeleteRepo({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): Promise<void> {
  const linked = await db.query.apps.findMany({
    where: and(eq(apps.githubOrg, owner), eq(apps.githubRepo, repo)),
  });
  if (linked.length > 0) {
    throw new DyadError(
      `Cannot delete this repository: ${linked.length} Meta Human OS project(s) are still linked. Disconnect them first.`,
      DyadErrorKind.Precondition,
    );
  }

  await githubApiJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { method: "DELETE" },
  );
}

async function handleListContents({
  owner,
  repo,
  path = "",
}: {
  owner: string;
  repo: string;
  path?: string;
}): Promise<
  Array<{
    name: string;
    path: string;
    type: "file" | "dir" | "symlink" | "submodule";
    sha?: string;
    size?: number;
  }>
> {
  const encodedPath = path
    ? `/${path.split("/").map(encodeURIComponent).join("/")}`
    : "";
  const res = await githubApiFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedPath}`,
  );

  if (res.status === 404) {
    return [];
  }

  if (!res.ok) {
    let message = `Failed to list files (${res.status})`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // ignore
    }
    throw new DyadError(message, DyadErrorKind.External);
  }

  const data = (await res.json()) as
    | {
        name: string;
        path: string;
        type: string;
        sha?: string;
        size?: number;
      }
    | Array<{
        name: string;
        path: string;
        type: string;
        sha?: string;
        size?: number;
      }>;

  const entries = Array.isArray(data) ? data : [data];
  return entries
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type as "file" | "dir" | "symlink" | "submodule",
      sha: entry.sha,
      size: entry.size,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

async function handleGetContent({
  owner,
  repo,
  path,
}: {
  owner: string;
  repo: string;
  path: string;
}): Promise<{ path: string; content: string; sha: string; encoding: "utf-8" }> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const data = await githubApiJson<{
    path: string;
    content: string;
    sha: string;
    encoding: string;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
  );

  if (data.encoding !== "base64") {
    throw new DyadError(
      "Only text files are supported in the GitHub manager.",
      DyadErrorKind.Validation,
    );
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return {
    path: data.path,
    content,
    sha: data.sha,
    encoding: "utf-8",
  };
}

async function handleUpsertContent({
  owner,
  repo,
  path,
  content,
  message,
  sha,
}: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
}): Promise<{ sha: string }> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) {
    body.sha = sha;
  }

  const result = await githubApiJson<{ content: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    { method: "PUT", body },
  );

  return { sha: result.content.sha };
}

async function handleDeleteContent({
  owner,
  repo,
  path,
  message,
  sha,
}: {
  owner: string;
  repo: string;
  path: string;
  message: string;
  sha: string;
}): Promise<void> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  await githubApiJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      method: "DELETE",
      body: { message, sha },
    },
  );
}

export function registerGithubManagerHandlers() {
  createTypedHandler(githubContracts.setAccessToken, async (_event, params) => {
    return handleSetAccessToken(params);
  });

  createTypedHandler(githubContracts.getAccount, async () => {
    return handleGetAccount();
  });

  createTypedHandler(
    githubContracts.createManagerRepo,
    async (_event, params) => {
      return handleCreateManagerRepo(params);
    },
  );

  createTypedHandler(githubContracts.deleteRepo, async (_event, params) => {
    return handleDeleteRepo(params);
  });

  createTypedHandler(githubContracts.listContents, async (_event, params) => {
    return handleListContents(params);
  });

  createTypedHandler(githubContracts.getContent, async (_event, params) => {
    return handleGetContent(params);
  });

  createTypedHandler(githubContracts.upsertContent, async (_event, params) => {
    return handleUpsertContent(params);
  });

  createTypedHandler(githubContracts.deleteContent, async (_event, params) => {
    return handleDeleteContent(params);
  });

  logger.info("GitHub manager handlers registered");
}
