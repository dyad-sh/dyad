/**
 * The Cloudflare API calls Dyad makes to set up and watch Worker deployments.
 *
 * Every function takes the user's API token. Failures surface as
 * `CloudflareApiError`, which keeps Cloudflare's numeric error codes because
 * several flows branch on them.
 */

import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { DeployRuleBody } from "./build_config";

export function getCloudflareApiBase(): string {
  return IS_TEST_BUILD
    ? `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}/cloudflare/api`
    : "https://api.cloudflare.com/client/v4";
}

/** Cloudflare has no workers.dev subdomain for this account yet. */
const CODE_NO_ACCOUNT_SUBDOMAIN = 10007;
/** The builds API cannot see the repository it was asked about. */
const CODE_BUILDS_NOT_FOUND = 12000;

interface CloudflareErrorInfo {
  code?: number;
  message?: string;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  errors?: CloudflareErrorInfo[];
  result?: T;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[],
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }

  hasCode(code: number): boolean {
    return this.codes.includes(code);
  }
}

/** Classifies an API failure so expected ones stay out of error telemetry. */
export function toCloudflareDyadError(error: unknown, action: string): Error {
  if (error instanceof DyadError) {
    return error;
  }
  if (error instanceof CloudflareApiError) {
    const kind =
      error.status === 401 || error.status === 403
        ? DyadErrorKind.Auth
        : error.status === 404
          ? DyadErrorKind.NotFound
          : error.status === 429
            ? DyadErrorKind.RateLimited
            : DyadErrorKind.External;
    return new DyadError(`${action}: ${error.message}`, kind);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DyadError(`${action}: ${message}`, DyadErrorKind.External);
}

async function request<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${getCloudflareApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !isForm
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : isForm
          ? (body as FormData)
          : JSON.stringify(body),
  });

  let envelope: CloudflareEnvelope<T> | undefined;
  try {
    envelope = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    envelope = undefined;
  }

  if (!response.ok || envelope?.success === false) {
    const errors = envelope?.errors ?? [];
    const message =
      errors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ") || `${response.status} ${response.statusText}`;
    throw new CloudflareApiError(
      message,
      response.status,
      errors.flatMap((error) => (error.code === undefined ? [] : [error.code])),
    );
  }

  return envelope?.result as T;
}

// ---------------------------------------------------------------------------
// Token and accounts
// ---------------------------------------------------------------------------

export interface CloudflareTokenInfo {
  id: string;
  status: string;
}

export function verifyToken(token: string): Promise<CloudflareTokenInfo> {
  return request<CloudflareTokenInfo>(token, "GET", "/user/tokens/verify");
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export async function listAccounts(
  token: string,
): Promise<CloudflareAccount[]> {
  const accounts = await request<CloudflareAccount[]>(
    token,
    "GET",
    "/accounts?per_page=50",
  );
  return (accounts ?? []).map(({ id, name }) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export interface CloudflareWorker {
  name: string;
  /** Immutable id the builds API uses instead of the name. */
  tag: string;
}

export async function listWorkers(
  token: string,
  accountId: string,
): Promise<CloudflareWorker[]> {
  const scripts = await request<{ id: string; tag: string }[]>(
    token,
    "GET",
    `/accounts/${accountId}/workers/scripts`,
  );
  return (scripts ?? []).map((script) => ({
    name: script.id,
    tag: script.tag,
  }));
}

const PLACEHOLDER_WORKER_SOURCE = `export default {
  fetch() {
    return new Response("This Worker is waiting for its first deployment.");
  },
};
`;

/**
 * Creates a Worker holding a stand-in script. A deploy rule can only attach
 * to a Worker that exists; the first build replaces the script.
 */
export async function createPlaceholderWorker(
  token: string,
  accountId: string,
  name: string,
): Promise<CloudflareWorker> {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "index.mjs",
          compatibility_date: "2026-01-01",
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.append(
    "index.mjs",
    new Blob([PLACEHOLDER_WORKER_SOURCE], {
      type: "application/javascript+module",
    }),
    "index.mjs",
  );
  const result = await request<{ tag: string }>(
    token,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${name}`,
    form,
  );
  return { name, tag: result.tag };
}

export async function deleteWorker(
  token: string,
  accountId: string,
  name: string,
): Promise<void> {
  await request(
    token,
    "DELETE",
    `/accounts/${accountId}/workers/scripts/${name}?force=true`,
  );
}

export async function enableWorkersDevRoute(
  token: string,
  accountId: string,
  name: string,
): Promise<void> {
  await request(
    token,
    "POST",
    `/accounts/${accountId}/workers/scripts/${name}/subdomain`,
    { enabled: true, previews_enabled: true },
  );
}

/** The account's workers.dev subdomain, or null when it has none yet. */
export async function getAccountSubdomain(
  token: string,
  accountId: string,
): Promise<string | null> {
  try {
    const result = await request<{ subdomain?: string }>(
      token,
      "GET",
      `/accounts/${accountId}/workers/subdomain`,
    );
    return result?.subdomain ?? null;
  } catch (error) {
    if (
      error instanceof CloudflareApiError &&
      error.hasCode(CODE_NO_ACCOUNT_SUBDOMAIN)
    ) {
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Builds: repository access, connections, tokens
// ---------------------------------------------------------------------------

export interface GithubRepoIdentity {
  ownerId: string;
  ownerLogin: string;
  repoId: string;
  repoName: string;
}

/**
 * Whether Cloudflare's GitHub App can read the repository. Cloudflare answers
 * "not found" both when GitHub was never connected and when this repository
 * was left out of the install, so the caller cannot tell those apart.
 */
export async function canCloudflareSeeRepo(
  token: string,
  accountId: string,
  repo: GithubRepoIdentity,
  branch: string,
): Promise<boolean> {
  try {
    await request(
      token,
      "GET",
      `/accounts/${accountId}/builds/repos/github/${repo.ownerId}/${repo.repoId}/config_autofill?branch=${encodeURIComponent(branch)}`,
    );
    return true;
  } catch (error) {
    if (
      error instanceof CloudflareApiError &&
      (error.hasCode(CODE_BUILDS_NOT_FOUND) || error.status === 404)
    ) {
      return false;
    }
    throw error;
  }
}

export async function upsertRepoConnection(
  token: string,
  accountId: string,
  repo: GithubRepoIdentity,
): Promise<string> {
  const result = await request<{ repo_connection_uuid: string }>(
    token,
    "PUT",
    `/accounts/${accountId}/builds/repos/connections`,
    {
      provider_type: "github",
      provider_account_id: repo.ownerId,
      provider_account_name: repo.ownerLogin,
      repo_id: repo.repoId,
      repo_name: repo.repoName,
    },
  );
  return result.repo_connection_uuid;
}

interface BuildToken {
  build_token_uuid: string;
  cloudflare_token_id?: string;
}

/**
 * Registers the API token as the credential Cloudflare's build service
 * deploys with, reusing an existing registration of the same token.
 */
export async function ensureBuildToken(
  token: string,
  accountId: string,
  tokenId: string,
): Promise<string> {
  const existing = await request<BuildToken[]>(
    token,
    "GET",
    `/accounts/${accountId}/builds/tokens`,
  );
  const match = (existing ?? []).find(
    (candidate) => candidate.cloudflare_token_id === tokenId,
  );
  if (match) {
    return match.build_token_uuid;
  }
  const created = await request<BuildToken>(
    token,
    "POST",
    `/accounts/${accountId}/builds/tokens`,
    {
      build_token_name: "Dyad",
      build_token_secret: token,
      cloudflare_token_id: tokenId,
    },
  );
  return created.build_token_uuid;
}

/** Confirms the token can use the builds API at all. */
export async function probeBuildsAccess(
  token: string,
  accountId: string,
): Promise<void> {
  await request(token, "GET", `/accounts/${accountId}/builds/tokens`);
}

// ---------------------------------------------------------------------------
// Builds: deploy rules and builds
// ---------------------------------------------------------------------------

export interface CloudflareTrigger {
  trigger_uuid: string;
  root_directory?: string;
  branch_includes?: string[];
  repo_connection_uuid?: string;
  repo_connection?: {
    repo_connection_uuid?: string;
    repo_name?: string;
    provider_account_name?: string;
  };
}

export function getTriggerRepoConnectionUuid(
  trigger: CloudflareTrigger,
): string | undefined {
  return (
    trigger.repo_connection?.repo_connection_uuid ??
    trigger.repo_connection_uuid
  );
}

export function describeTriggerRepo(trigger: CloudflareTrigger): string {
  const owner = trigger.repo_connection?.provider_account_name;
  const name = trigger.repo_connection?.repo_name;
  if (owner && name) return `${owner}/${name}`;
  return name ?? "another repository";
}

export async function listTriggers(
  token: string,
  accountId: string,
  workerTag: string,
): Promise<CloudflareTrigger[]> {
  const triggers = await request<CloudflareTrigger[]>(
    token,
    "GET",
    `/accounts/${accountId}/builds/workers/${workerTag}/triggers`,
  );
  return triggers ?? [];
}

export async function createTrigger(
  token: string,
  accountId: string,
  rule: DeployRuleBody,
): Promise<string> {
  const result = await request<CloudflareTrigger>(
    token,
    "POST",
    `/accounts/${accountId}/builds/triggers`,
    rule,
  );
  return result.trigger_uuid;
}

export async function updateTrigger(
  token: string,
  accountId: string,
  triggerUuid: string,
  rule: DeployRuleBody,
): Promise<void> {
  // The Worker a rule belongs to cannot be changed after creation.
  const { external_script_id: _workerTag, ...changes } = rule;
  await request(
    token,
    "PATCH",
    `/accounts/${accountId}/builds/triggers/${triggerUuid}`,
    changes,
  );
}

/** Sets plain build-time variables on a rule, leaving its others in place. */
export async function setTriggerBuildVariables(
  token: string,
  accountId: string,
  triggerUuid: string,
  variables: Record<string, string>,
): Promise<void> {
  await request(
    token,
    "PATCH",
    `/accounts/${accountId}/builds/triggers/${triggerUuid}/environment_variables`,
    Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        { value, is_secret: false },
      ]),
    ),
  );
}

/** Points an existing rule at a different deploy credential. */
export async function setTriggerBuildToken(
  token: string,
  accountId: string,
  triggerUuid: string,
  buildTokenUuid: string,
): Promise<void> {
  await request(
    token,
    "PATCH",
    `/accounts/${accountId}/builds/triggers/${triggerUuid}`,
    { build_token_uuid: buildTokenUuid },
  );
}

/** Deleting a rule that is already gone is not a failure. */
export async function deleteTrigger(
  token: string,
  accountId: string,
  triggerUuid: string,
): Promise<void> {
  try {
    await request(
      token,
      "DELETE",
      `/accounts/${accountId}/builds/triggers/${triggerUuid}`,
    );
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

export async function startBuild(
  token: string,
  accountId: string,
  triggerUuid: string,
  branch: string,
): Promise<void> {
  await request(
    token,
    "POST",
    `/accounts/${accountId}/builds/triggers/${triggerUuid}/builds`,
    { branch },
  );
}

export interface CloudflareBuild {
  build_uuid: string;
  status?: string | null;
  build_outcome?: string | null;
  created_on?: string | null;
  build_trigger_metadata?: { commit_hash?: string | null } | null;
}

/** The newest build for a Worker, or null before the first one. */
export async function getLatestBuild(
  token: string,
  accountId: string,
  workerTag: string,
): Promise<CloudflareBuild | null> {
  const builds = await request<CloudflareBuild[]>(
    token,
    "GET",
    `/accounts/${accountId}/builds/workers/${workerTag}/builds`,
  );
  if (!builds || builds.length === 0) {
    return null;
  }
  return [...builds].sort((a, b) =>
    (b.created_on ?? "").localeCompare(a.created_on ?? ""),
  )[0];
}

export async function getBuildLogLines(
  token: string,
  accountId: string,
  buildUuid: string,
): Promise<string[]> {
  const result = await request<{ lines?: [number, string][] }>(
    token,
    "GET",
    `/accounts/${accountId}/builds/builds/${buildUuid}/logs`,
  );
  return (result?.lines ?? []).map((line) => String(line[1] ?? ""));
}
