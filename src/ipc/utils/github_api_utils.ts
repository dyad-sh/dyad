import fetch from "node-fetch";
import { readSettings } from "../../main/settings";
import { IS_TEST_BUILD } from "./test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const TEST_SERVER_BASE = `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}`;

export const GITHUB_API_BASE = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/github/api`
  : "https://api.github.com";

export function getGithubAccessToken(): string {
  const token = readSettings().githubAccessToken?.value;
  if (!token) {
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  return token;
}

export async function githubApiFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): ReturnType<typeof fetch> {
  const accessToken = getGithubAccessToken();
  const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function githubApiJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const res = await githubApiFetch(path, options);
  if (!res.ok) {
    let message = `GitHub API error (${res.status} ${res.statusText})`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // ignore non-json body
    }
    if (res.status === 401 || res.status === 403) {
      throw new DyadError(message, DyadErrorKind.Auth);
    }
    throw new DyadError(message, DyadErrorKind.External);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new DyadError(
      `Invalid repository name: ${fullName}`,
      DyadErrorKind.Validation,
    );
  }
  return { owner, repo };
}

export async function fetchGithubAccount(): Promise<{
  login: string;
  email: string;
}> {
  const user = await githubApiJson<{ login: string }>("/user");
  let email = "";
  try {
    const emails = await githubApiJson<
      Array<{ email?: string; primary?: boolean }>
    >("/user/emails");
    email = emails.find((e) => e.primary)?.email ?? emails[0]?.email ?? "";
  } catch {
    // email scope may be missing for some PATs
  }
  return { login: user.login, email };
}
