/**
 * Pure builders for what Dyad sends to Cloudflare: the prefilled API token
 * form, Worker names, and the rule that deploys a target on every push.
 */

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { slugifyAppPath } from "@/shared/slugify";

// ---------------------------------------------------------------------------
// API token form
// ---------------------------------------------------------------------------

/**
 * What the token must be able to do. The same token serves Dyad, which sets
 * up Workers and deploy rules, and Cloudflare's build service, which runs the
 * deploy after each push.
 */
const TOKEN_PERMISSIONS = [
  { key: "account_settings", type: "read" },
  { key: "workers_scripts", type: "edit" },
  { key: "workers_ci", type: "edit" },
  { key: "workers_kv_storage", type: "edit" },
  { key: "workers_r2", type: "edit" },
  { key: "workers_routes", type: "edit" },
  { key: "user_details", type: "read" },
  { key: "memberships", type: "read" },
] as const;

/**
 * A link that opens Cloudflare's token form with the permissions chosen.
 *
 * It must be a user token, created from the profile page: the builds API
 * rejects tokens owned by an account.
 */
export function buildCloudflareTokenTemplateUrl(): string {
  const url = new URL("https://dash.cloudflare.com/profile/api-tokens");
  url.searchParams.set(
    "permissionGroupKeys",
    JSON.stringify(TOKEN_PERMISSIONS),
  );
  url.searchParams.set("accountId", "*");
  url.searchParams.set("zoneId", "all");
  url.searchParams.set("name", "Dyad");
  return url.toString();
}

/** Where a user connects Cloudflare to GitHub for the first time. */
export const CLOUDFLARE_CONNECT_GITHUB_URL =
  "https://dash.cloudflare.com/?to=/:account/workers/workers-and-pages";

/** Where a user adds a repository to an existing Cloudflare GitHub install. */
export const CLOUDFLARE_GITHUB_APP_URL =
  "https://github.com/apps/cloudflare-workers-and-pages/installations/new";

export function buildCloudflareWorkerDashboardUrl({
  accountId,
  workerName,
}: {
  accountId: string;
  workerName: string;
}): string {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production`;
}

// ---------------------------------------------------------------------------
// Worker names
// ---------------------------------------------------------------------------

const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Cloudflare's rule: lowercase letters, digits and dashes, at most 63 long. */
export function isValidWorkerName(name: string): boolean {
  return WORKER_NAME_PATTERN.test(name);
}

/**
 * A valid Worker name derived from free text. The app slug is already
 * lowercase letters, digits and dashes within the length limit.
 */
export function toWorkerName(text: string): string {
  return slugifyAppPath(text);
}

/**
 * The name offered for a target's Worker: the one its Wrangler config already
 * declares, otherwise one built from the app and the target's folder.
 */
export function suggestWorkerName({
  configName,
  appName,
  rootDirectory,
}: {
  configName: string | null;
  appName: string;
  rootDirectory: string;
}): string {
  if (configName && isValidWorkerName(configName)) {
    return configName;
  }
  const folder = rootDirectory.split("/").filter(Boolean).pop();
  return toWorkerName(folder ? `${appName}-${folder}` : appName);
}

// ---------------------------------------------------------------------------
// Deploy rule
// ---------------------------------------------------------------------------

export interface DeployRuleInput {
  workerTag: string;
  workerName: string;
  repoConnectionUuid: string;
  buildTokenUuid: string;
  /** Path from the repository root, "" for the root itself. */
  rootDirectory: string;
  branch: string;
  hasBuildScript: boolean;
}

export interface DeployRuleBody {
  external_script_id: string;
  repo_connection_uuid: string;
  build_token_uuid: string;
  trigger_name: string;
  build_command: string;
  deploy_command: string;
  root_directory: string;
  branch_includes: string[];
  branch_excludes: string[];
  path_includes: string[];
  path_excludes: string[];
}

/**
 * The rule Cloudflare runs on each push to the branch.
 *
 * The deploy always names the Worker, so the one the user chose is the one
 * deployed whatever the Wrangler config calls itself. A target in a subfolder
 * is only rebuilt by changes inside that folder.
 */
export function buildDeployRule(input: DeployRuleInput): DeployRuleBody {
  if (!isValidWorkerName(input.workerName)) {
    // The name is interpolated into a shell command run by Cloudflare.
    throw new DyadError(
      `Invalid Worker name: ${input.workerName}`,
      DyadErrorKind.Validation,
    );
  }
  const isRoot = input.rootDirectory === "";
  return {
    external_script_id: input.workerTag,
    repo_connection_uuid: input.repoConnectionUuid,
    build_token_uuid: input.buildTokenUuid,
    trigger_name: "Deploy from Dyad",
    build_command: input.hasBuildScript ? "npm run build" : "",
    deploy_command: `npx wrangler deploy --name ${input.workerName}`,
    root_directory: isRoot ? "/" : `/${input.rootDirectory}`,
    branch_includes: [input.branch],
    branch_excludes: [],
    path_includes: isRoot ? ["*"] : [`${input.rootDirectory}/*`],
    path_excludes: [],
  };
}

/**
 * The pnpm version Cloudflare should install a pnpm project with, or null to
 * leave its default alone.
 *
 * Cloudflare's build image pins an older pnpm than current projects are
 * written for: a `pnpm-workspace.yaml` holding only settings, which is what
 * Cloudflare's own project scaffolder writes, makes that pnpm refuse to
 * install at all. The project's pin wins; otherwise the pnpm on this machine
 * is the one the lockfile was written by.
 */
export function pnpmVersionForBuild({
  packageManagerField,
  localPnpmVersion,
}: {
  packageManagerField: string | null;
  localPnpmVersion: string | null;
}): string | null {
  const pinned = /^pnpm@(\d+\.\d+\.\d+[^+\s]*)/.exec(packageManagerField ?? "");
  if (pinned) return pinned[1];
  return localPnpmVersion && /^\d+\.\d+\.\d+/.test(localPnpmVersion)
    ? localPnpmVersion
    : null;
}

// ---------------------------------------------------------------------------
// Build status
// ---------------------------------------------------------------------------

export type CloudflareDeploymentState =
  | "none"
  | "queued"
  | "building"
  | "live"
  | "failed"
  | "cancelled";

/** Collapses Cloudflare's build status and outcome into what the UI shows. */
export function toDeploymentState(build: {
  status?: string | null;
  build_outcome?: string | null;
}): CloudflareDeploymentState {
  const status = build.status ?? "";
  if (status === "queued") return "queued";
  if (status === "initializing" || status === "running") return "building";
  if (status === "stopped") {
    const outcome = build.build_outcome ?? "";
    if (outcome === "success") return "live";
    if (outcome === "cancelled" || outcome === "canceled") return "cancelled";
    return "failed";
  }
  return "none";
}

export function isDeploymentInProgress(
  state: CloudflareDeploymentState,
): boolean {
  return state === "queued" || state === "building";
}

/**
 * Cloudflare's message when the API token behind a deploy rule no longer
 * exists. The fix is a new token, not a code change, so the UI says so.
 */
export function isBuildTokenRevokedLog(lines: string[]): boolean {
  return lines.some((line) =>
    /build token .* has been deleted or rolled/i.test(line),
  );
}
