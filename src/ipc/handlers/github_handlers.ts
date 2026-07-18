import { IpcMainInvokeEvent } from "electron";
import fetch from "node-fetch"; // Use node-fetch for making HTTP requests in main process
import { writeSettings, readSettings } from "../../main/settings";
import {
  gitSetRemoteUrl,
  gitPush,
  gitClone,
  gitPull,
  gitRebaseAbort,
  gitRebaseContinue,
  gitRebase,
  gitFetch,
  gitCreateBranch,
  gitCheckout,
  gitGetMergeConflicts,
  gitListBranches,
  gitListRemoteBranches,
  isGitStatusClean,
  isGitMergeInProgress,
  isGitRebaseInProgress,
  GitConflictError,
} from "../utils/git_utils";
import { gitService } from "../services/git_service";
import * as schema from "../../db/schema";
import fs from "node:fs";
import { getDyadAppPath, isAppLocationAccessible } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { GithubUser } from "../../lib/schemas";
import log from "electron-log";
import { IS_TEST_BUILD } from "../utils/test_utils";
import path from "node:path";
import { withLock } from "../utils/lock_utils";
import { createTypedHandler } from "./base";
import { githubContracts } from "../types/github";
import type { CloneRepoParams, CloneRepoResult } from "../types/github";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { slugifyAppPath } from "@/shared/slugify";
import {
  isComponentTaggerUpgradeNeeded,
  applyComponentTagger,
} from "../utils/app_upgrade_utils";
import {
  connectionFlowRegistry,
  registerConnectionFlowProvider,
  runOAuthReturnExchange,
} from "./connection_flow_handlers";

const logger = log.scope("github_handlers");

/**
 * Normalizes a repository name to a kebab-case slug so it is a valid GitHub repo
 * name AND a valid Vercel project name (Vercel requires lowercase names). This
 * mirrors how app folder paths are derived (via `slugifyAppPath`), keeping the
 * repo and Vercel project names consistent with the app's folder.
 * @param repoName - The original repository name
 * @returns The kebab-case repository name (e.g. "TaskMaster Pro" -> "task-master-pro")
 */
export function normalizeGitHubRepoName(repoName: string): string {
  return slugifyAppPath(repoName);
}

// --- GitHub Device Flow Constants ---
// TODO: Fetch this securely, e.g., from environment variables or a config file
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "Ov23liWV2HdC0RBLecWx";

function isGitHubTestBuild() {
  return IS_TEST_BUILD || process.env.E2E_TEST_BUILD === "true";
}

function getGitHubTestServerBase() {
  return `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}`;
}

function getGitHubDeviceCodeUrl() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/login/device/code`
    : "https://github.com/login/device/code";
}

function getGitHubAccessTokenUrl() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/login/oauth/access_token`
    : "https://github.com/login/oauth/access_token";
}

function getGitHubApiBase() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/api`
    : "https://api.github.com";
}

function getGitHubGitBase() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/git`
    : "https://github.com";
}

const GITHUB_SCOPES = "repo,user,workflow"; // Define the scopes needed

// --- Device Flow State ---
//
// The authoritative flow state (what the renderer sees) lives in the
// connection flow registry, keyed per provider and correlated by flowId.
// This map only holds GitHub-specific polling internals for each flow.
interface DeviceFlowRecord {
  deviceCode: string;
  interval: number;
  timeoutId: NodeJS.Timeout | null;
}

const deviceFlows = new Map<string, DeviceFlowRecord>();

// --- Helper Functions ---

/**
 * Fetches the GitHub username of the currently authenticated user (using the stored access token).
 * @returns {Promise<string|null>} The GitHub username, or null if not authenticated or on error.
 */
export async function getGithubUser(): Promise<GithubUser | null> {
  const settings = readSettings();
  const email = settings.githubUser?.email;
  if (email) return { email };
  try {
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) return null;
    const res = await fetch(`${getGitHubApiBase()}/user/emails`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as Array<{
      primary?: boolean;
      email?: string;
    }>;
    const email = emails.find((e: any) => e.primary)?.email;
    if (!email) return null;

    writeSettings({
      githubUser: {
        email,
      },
    });
    return { email };
  } catch (err) {
    logger.error("[GitHub Handler] Failed to get GitHub username:", err);
    return null;
  }
}

export async function prepareLocalBranch({
  appId,
  branch,
  remoteUrl,
  accessToken,
}: {
  appId: number;
  branch?: string;
  remoteUrl?: string;
  accessToken?: string;
}) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  const appPath = getDyadAppPath(app.path);
  const targetBranch = branch || "main";

  try {
    // Set up remote URL if provided (should be set up before calling this)
    if (remoteUrl) {
      await gitSetRemoteUrl({
        path: appPath,
        remoteUrl,
      });

      // Fetch remote branches if we have access token and remote URL
      // This allows us to check if the branch exists remotely
      if (accessToken) {
        try {
          await gitFetch({
            path: appPath,
            remote: "origin",
            accessToken,
          });
        } catch (fetchError: any) {
          // For new repos, fetch might fail because the repo is empty
          // This is okay - we'll just create the branch locally
          logger.debug(
            `[GitHub Handler] Fetch failed (expected for new repos): ${fetchError?.message || "Unknown error"}`,
          );
        }
      }
    }

    // Use locking to prevent race conditions when multiple operations attempt to modify the repository
    // This ensures atomicity and prevents conflicts between concurrent operations
    await withLock(appId, async () => {
      const isClean = await isGitStatusClean({ path: appPath });
      if (!isClean) {
        if (isGitMergeInProgress({ path: appPath })) {
          throw new Error(
            "Cannot auto-commit changes because a merge is in progress. " +
              "Please complete or abort the merge and try again.",
          );
        }
        if (isGitRebaseInProgress({ path: appPath })) {
          throw new Error(
            "Cannot auto-commit changes because a rebase is in progress. " +
              "Please complete or abort the rebase and try again.",
          );
        }

        try {
          const commitHash = await gitService.stageAllAndCommit({
            path: appPath,
            message:
              "chore: auto-commit local changes before connecting to GitHub",
          });
          logger.info(
            `[GitHub Handler] Auto-committed local changes (${commitHash}) before preparing branch '${targetBranch}'.`,
          );
        } catch (commitError) {
          logger.error(
            "[GitHub Handler] Failed to auto-commit local changes before preparing branch:",
            commitError,
          );
          throw new Error(
            "Failed to auto-commit uncommitted changes. Please commit or stash your changes manually and try again.",
          );
        }
      }

      await ensureCleanWorkspace(appPath, `preparing branch '${targetBranch}'`);

      // List branches and check if target branch exists
      const localBranches = await gitListBranches({ path: appPath });

      // Check if branch exists remotely (if remote was set up)
      let remoteBranches: string[] = [];
      if (remoteUrl && accessToken) {
        remoteBranches = await gitListRemoteBranches({
          path: appPath,
          remote: "origin",
        });
      }

      if (!localBranches.includes(targetBranch)) {
        // If branch exists remotely, create local tracking branch
        // Otherwise, create a new local branch
        if (remoteBranches.includes(targetBranch)) {
          await gitCreateBranch({
            path: appPath,
            branch: targetBranch,
            from: `origin/${targetBranch}`,
          });
          await gitCheckout({ path: appPath, ref: targetBranch });
        } else {
          // Create new local branch
          await gitCreateBranch({
            path: appPath,
            branch: targetBranch,
          });
          await gitCheckout({ path: appPath, ref: targetBranch });
        }
      } else {
        // Branch exists locally, just checkout
        await gitCheckout({ path: appPath, ref: targetBranch });
      }
    });
  } catch (gitError: any) {
    logger.error("[GitHub Handler] Failed to prepare local branch:", gitError);
    // Check if error is about uncommitted changes (fallback in case check above missed it)
    const errorMessage =
      gitError?.message ||
      "Failed to prepare local branch for the connected repository.";
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes("local changes") ||
      lowerMessage.includes("would be overwritten") ||
      lowerMessage.includes("please commit or stash")
    ) {
      throw new Error(
        `Failed to prepare local branch: uncommitted changes detected. ` +
          "Unable to automatically handle uncommitted changes. Please commit or stash your changes manually and try again.",
      );
    }
    throw new Error(errorMessage);
  }
}
async function pollForAccessToken(flowId: string) {
  const record = deviceFlows.get(flowId);
  const flowState = connectionFlowRegistry.getState("github");
  if (
    !record ||
    flowState.status !== "awaiting-return" ||
    flowState.flowId !== flowId
  ) {
    // Flow was cancelled, failed, or superseded — stop polling.
    logger.debug("[GitHub Handler] Polling stopped or no active flow.");
    cleanupDeviceFlow(flowId);
    return;
  }

  logger.debug("[GitHub Handler] Polling for token with device code");

  try {
    const response = await fetch(getGitHubAccessTokenUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: record.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (response.ok && data.access_token) {
      logger.log("Successfully obtained GitHub Access Token.");
      // The token is always written, even if the flow was cancelled while
      // this request was in flight — GitHub already authorized us, and
      // dropping the token would leave the account half-connected.
      // `expectedFlowId` correlates the write with THIS poll chain's flow:
      // if the user cancelled and started a newer flow while this request
      // was in flight, the stale result lands as unsolicited instead of
      // advancing the newer flow.
      const outcome = await runOAuthReturnExchange(
        "github",
        () => {
          writeSettings({
            githubAccessToken: {
              value: data.access_token!,
            },
          });
        },
        { expectedFlowId: flowId },
      );
      if (!outcome.ok) {
        // A claimed failure was already recorded on the flow; rethrow only
        // unclaimed failures so the generic network-error handling applies.
        if (!outcome.claimed) {
          throw outcome.error;
        }
      }
      cleanupDeviceFlow(flowId);
      return;
    } else if (data.error) {
      switch (data.error) {
        case "authorization_pending":
          logger.debug("Authorization pending...");
          record.timeoutId = setTimeout(
            () => pollForAccessToken(flowId),
            record.interval * 1000,
          );
          break;
        case "slow_down": {
          const newInterval = record.interval + 5;
          logger.debug(`Slow down requested. New interval: ${newInterval}s`);
          record.interval = newInterval;
          record.timeoutId = setTimeout(
            () => pollForAccessToken(flowId),
            newInterval * 1000,
          );
          break;
        }
        case "expired_token":
          logger.error("Device code expired.");
          connectionFlowRegistry.fail(
            "github",
            flowId,
            "timeout",
            "Verification code expired. Please try again.",
          );
          break;
        case "access_denied":
          logger.error("Access denied by user.");
          connectionFlowRegistry.fail(
            "github",
            flowId,
            "user_cancelled",
            "Authorization denied by user.",
          );
          break;
        default:
          logger.error(
            `Unknown GitHub error: ${data.error_description || data.error}`,
          );
          connectionFlowRegistry.fail(
            "github",
            flowId,
            "token_invalid",
            `GitHub authorization error: ${data.error_description || data.error}`,
          );
          break;
      }
    } else {
      throw new DyadError(
        `Unknown response structure: ${JSON.stringify(data)}`,
        DyadErrorKind.External,
      );
    }
  } catch (error) {
    logger.error("Error polling for GitHub access token:", error);
    connectionFlowRegistry.fail(
      "github",
      flowId,
      "network",
      `Network or unexpected error during polling: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Releases the polling timer and device code for a flow. Wired as the
 * registry's `onFlowEnded` hook, so it runs whenever the flow reaches a
 * terminal state — cancel IPC, timeout, failure, or success — even if the
 * renderer that started the flow is long gone.
 */
function cleanupDeviceFlow(flowId: string) {
  const record = deviceFlows.get(flowId);
  if (!record) {
    return;
  }
  if (record.timeoutId) {
    clearTimeout(record.timeoutId);
  }
  deviceFlows.delete(flowId);
  logger.debug("[GitHub Handler] Device flow cleaned up:", flowId);
}

/**
 * Starts the GitHub device flow for a freshly allocated flowId. Invoked via
 * the connection flow registry (`connection-flow:start` with provider
 * "github"), which guarantees at most one active GitHub flow at a time —
 * without blocking flows for other providers.
 */
async function startGithubDeviceFlow({
  flowId,
}: {
  flowId: string;
  appId: number | null;
}) {
  logger.debug(`Starting GitHub device flow ${flowId}`);
  try {
    const res = await fetch(getGitHubDeviceCodeUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: GITHUB_SCOPES,
      }),
    });
    if (!res.ok) {
      const errData = (await res.json()) as any;
      throw new Error(
        `GitHub API Error: ${errData.error_description || res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      device_code: string;
      interval?: number;
      user_code: string;
      verification_uri: string;
    };

    logger.info("Received device code response");
    const record: DeviceFlowRecord = {
      deviceCode: data.device_code,
      interval: data.interval || 5,
      timeoutId: null,
    };
    deviceFlows.set(flowId, record);

    // The flow may have been cancelled while the device code request was in
    // flight; markPrepared is then ignored by the machine and we stand down.
    const prepared = connectionFlowRegistry.markPrepared("github", flowId, {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
    });
    if (!prepared) {
      cleanupDeviceFlow(flowId);
      return;
    }

    record.timeoutId = setTimeout(
      () => pollForAccessToken(flowId),
      record.interval * 1000,
    );
  } catch (error: any) {
    logger.error("Error initiating GitHub device flow:", error);
    connectionFlowRegistry.fail(
      "github",
      flowId,
      "network",
      `Failed to start GitHub connection: ${error.message}`,
    );
  }
}

// --- GitHub List Repos Handler ---
async function handleListGithubRepos(): Promise<
  { name: string; full_name: string; private: boolean }[]
> {
  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    // Fetch user's repositories
    const response = await fetch(
      `${getGitHubApiBase()}/user/repos?per_page=100&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response.json()) as any;
      throw new Error(
        `GitHub API error: ${errorData.message || response.statusText}`,
      );
    }

    const repos = (await response.json()) as any[];
    return repos.map((repo: any) => ({
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
    }));
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to list repos:", err);
    throw new Error(err.message || "Failed to list GitHub repositories.");
  }
}

// --- GitHub Get Repo Branches Handler ---
async function handleGetRepoBranches(
  event: IpcMainInvokeEvent,
  { owner, repo }: { owner: string; repo: string },
): Promise<{ name: string; commit: { sha: string } }[]> {
  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    // Fetch repository branches
    const response = await fetch(
      `${getGitHubApiBase()}/repos/${owner}/${repo}/branches`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response.json()) as any;
      throw new Error(
        `GitHub API error: ${errorData.message || response.statusText}`,
      );
    }

    const branches = (await response.json()) as any[];
    return branches.map((branch: any) => ({
      name: branch.name,
      commit: { sha: branch.commit.sha },
    }));
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to get repo branches:", err);
    throw new Error(err.message || "Failed to get repository branches.");
  }
}

// --- GitHub Repo Availability Handler ---
async function handleIsRepoAvailable(
  event: IpcMainInvokeEvent,
  { org, repo }: { org: string; repo: string },
): Promise<{ available: boolean; error?: string }> {
  // Normalize the repo name to match GitHub's automatic normalization
  const normalizedRepo = normalizeGitHubRepoName(repo);

  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      return { available: false, error: "Not authenticated with GitHub." };
    }
    // If org is empty, use the authenticated user
    const owner =
      org ||
      (await fetch(`${getGitHubApiBase()}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => r.json() as Promise<{ login?: string }>)
        .then((u) => u.login ?? ""));
    // Check if repo exists (using normalized name)
    const url = `${getGitHubApiBase()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(normalizedRepo)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      return { available: true };
    } else if (res.ok) {
      return { available: false, error: "Repository already exists." };
    } else {
      const data = (await res.json()) as any;
      return { available: false, error: data.message || "Unknown error" };
    }
  } catch (err: any) {
    return { available: false, error: err.message || "Unknown error" };
  }
}

// --- GitHub Create Repo Handler ---
async function handleCreateRepo(
  event: IpcMainInvokeEvent,
  {
    org,
    repo,
    appId,
    branch,
  }: { org: string; repo: string; appId: number; branch?: string },
): Promise<void> {
  // Normalize the repo name to match GitHub's automatic normalization
  // GitHub converts spaces to hyphens when creating repositories
  const normalizedRepo = normalizeGitHubRepoName(repo);

  // Get access token from settings
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  // If org is empty, create for the authenticated user
  let owner = org;
  if (!owner) {
    const userRes = await fetch(`${getGitHubApiBase()}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = (await userRes.json()) as { login?: string };
    owner = user.login ?? "";
  }
  // Create repo
  const createUrl = org
    ? `${getGitHubApiBase()}/orgs/${owner}/repos`
    : `${getGitHubApiBase()}/user/repos`;
  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      name: normalizedRepo,
      private: true,
    }),
  });
  if (!res.ok) {
    let errorMessage = `Failed to create repository (${res.status} ${res.statusText})`;
    try {
      const data = (await res.json()) as any;
      logger.error("GitHub API error when creating repo:", {
        status: res.status,
        statusText: res.statusText,
        response: data,
      });

      // Handle specific GitHub API error cases
      if (data.message) {
        errorMessage = data.message;
      }

      // Handle validation errors with more details
      if (data.errors && Array.isArray(data.errors)) {
        const errorDetails = data.errors
          .map((err: any) => {
            if (typeof err === "string") return err;
            if (err.message) return err.message;
            if (err.code) return `${err.field || "field"}: ${err.code}`;
            return JSON.stringify(err);
          })
          .join(", ");
        errorMessage = `${data.message || "Repository creation failed"}: ${errorDetails}`;
      }
    } catch (jsonError) {
      // If response is not JSON, fall back to status text
      logger.error("Failed to parse GitHub API error response:", {
        status: res.status,
        statusText: res.statusText,
        jsonError:
          jsonError instanceof Error ? jsonError.message : String(jsonError),
      });
      errorMessage = `GitHub API error: ${res.status} ${res.statusText}`;
    }

    throw new Error(errorMessage);
  }

  // Set up remote URL before preparing branch.
  // The URL is stored without credentials; auth is injected per-invocation
  // via environment variables in git_utils.
  const remoteUrl = `${getGitHubGitBase()}/${owner}/${normalizedRepo}.git`;

  // Prepare local branch with remote URL set up
  await prepareLocalBranch({
    appId,
    branch,
    remoteUrl,
    accessToken,
  });

  // Store org, repo (normalized), and branch in the app's DB row (apps table)
  await updateAppGithubRepo({
    appId,
    org: owner,
    repo: normalizedRepo,
    branch,
  });
}

// --- GitHub Connect to Existing Repo Handler ---
async function handleConnectToExistingRepo(
  event: IpcMainInvokeEvent,
  {
    owner,
    repo,
    branch,
    appId,
  }: { owner: string; repo: string; branch: string; appId: number },
): Promise<void> {
  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    // Verify the repository exists and user has access
    const repoResponse = await fetch(
      `${getGitHubApiBase()}/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!repoResponse.ok) {
      const errorData = (await repoResponse.json()) as { message?: string };
      throw new Error(
        `Repository not found or access denied: ${errorData.message}`,
      );
    }

    // Set up remote URL before preparing branch (credentials are never
    // stored in the URL; auth is injected per-invocation in git_utils)
    const remoteUrl = `${getGitHubGitBase()}/${owner}/${repo}.git`;

    // Prepare local branch with remote URL set up
    await prepareLocalBranch({
      appId,
      branch,
      remoteUrl,
      accessToken,
    });

    // Store org, repo, and branch in the app's DB row
    await updateAppGithubRepo({ appId, org: owner, repo, branch });
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to connect to existing repo:", err);
    throw new Error(err.message || "Failed to connect to existing repository.");
  }
}

// --- GitHub Push Handler ---
async function handlePushToGithub(
  event: IpcMainInvokeEvent,
  {
    appId,
    force,
    forceWithLease,
  }: {
    appId: number;
    force?: boolean;
    forceWithLease?: boolean;
  },
): Promise<void> {
  // Get access token from settings
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }

  // Get app info from DB
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "App is not linked to a GitHub repo.",
      DyadErrorKind.Precondition,
    );
  }
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch || "main";

  // Set up remote URL (credentials are never stored in the URL; auth is
  // injected per-invocation in git_utils). Re-setting it on every push also
  // scrubs tokens that older versions embedded in .git/config.
  const remoteUrl = `${getGitHubGitBase()}/${app.githubOrg}/${app.githubRepo}.git`;
  // Set or update remote URL using git config
  await gitSetRemoteUrl({
    path: appPath,
    remoteUrl,
  });

  // Pull changes first (unless force push)
  if (!force && !forceWithLease) {
    try {
      await gitPull({
        path: appPath,
        remote: "origin",
        branch,
        accessToken,
      });
    } catch (pullError: any) {
      // Check if it's a conflict error (including GitConflictError)
      if ((pullError as any)?.name === "GitConflictError") {
        throw GitConflictError(
          "Merge conflict detected during pull. Please resolve conflicts before pushing.",
        );
      }

      // Check for conflict in error message
      const errorMessage = pullError?.message || "";
      if (
        errorMessage.includes("merge conflict") ||
        errorMessage.includes("Merge conflict") ||
        errorMessage.includes("CONFLICT (") ||
        errorMessage.match(/failed to merge.*conflict/i)
      ) {
        throw GitConflictError(
          "Merge conflict detected during pull. Please resolve conflicts before pushing.",
        );
      }

      // Check if it's a missing remote branch error
      const isMissingRemoteBranch =
        pullError?.code === "MissingRefError" ||
        (pullError?.code === "NotFoundError" &&
          (errorMessage.includes("remote ref") ||
            errorMessage.includes("remote branch"))) ||
        errorMessage.includes("couldn't find remote ref") ||
        // Git operations fail when the remote repository is empty.
        errorMessage.includes("Cannot read properties of null");

      // If it's just that remote doesn't have the branch yet, we can ignore and push
      if (!isMissingRemoteBranch) {
        throw pullError;
      } else {
        logger.debug(
          "[GitHub Handler] Remote branch missing during pull, continuing with push",
          errorMessage,
        );
      }
    }
  }

  // Push to GitHub
  await gitPush({
    path: appPath,
    branch,
    accessToken,
    force,
    forceWithLease,
  });
}

async function handleAbortRebase(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitRebaseAbort({ path: appPath });
}

async function handleContinueRebase(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitRebaseContinue({ path: appPath });
}
// --- GitHub Rebase Handler ---
async function handleRebaseFromGithub(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "App is not linked to a GitHub repo.",
      DyadErrorKind.Precondition,
    );
  }
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch || "main";

  // Set up remote URL (credentials are never stored in the URL; auth is
  // injected per-invocation in git_utils)
  const remoteUrl = `${getGitHubGitBase()}/${app.githubOrg}/${app.githubRepo}.git`;
  // Set or update remote URL using git config
  await gitSetRemoteUrl({
    path: appPath,
    remoteUrl,
  });

  // Fetch latest changes from remote first
  await gitFetch({
    path: appPath,
    remote: "origin",
    accessToken,
  });

  // Check for uncommitted changes - Git requires a clean working directory for rebase
  await withLock(appId, async () => {
    await ensureCleanWorkspace(appPath, "rebase");
  });
  // Perform the rebase
  await gitRebase({
    path: appPath,
    branch,
  });
}

/**
 * Ensures the git workspace is clean before continuing an operation.
 */
export async function ensureCleanWorkspace(
  appPath: string,
  operationDescription: string,
): Promise<void> {
  const isClean = await isGitStatusClean({ path: appPath });
  if (isClean) return;
  throw new Error(
    `Workspace is not clean before ${operationDescription}. ` +
      "Please commit or stash your changes manually and try again.",
  );
}

async function handleGetGitState(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<{ mergeInProgress: boolean; rebaseInProgress: boolean }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const mergeInProgress = isGitMergeInProgress({ path: appPath });
  const rebaseInProgress = isGitRebaseInProgress({ path: appPath });

  return { mergeInProgress, rebaseInProgress };
}

async function handleListCollaborators(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<{ login: string; avatar_url: string; permissions: any }[]> {
  try {
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new DyadError(
        "App is not linked to a GitHub repo.",
        DyadErrorKind.Precondition,
      );
    }

    const response = await fetch(
      `${getGitHubApiBase()}/repos/${app.githubOrg}/${app.githubRepo}/collaborators`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to list collaborators: ${response.status} ${response.statusText}`,
      );
    }

    const collaborators = (await response.json()) as any[];
    return collaborators.map((c: any) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      permissions: c.permissions,
    }));
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to list collaborators:", err);
    throw new Error(err.message || "Failed to list collaborators.");
  }
}

async function handleInviteCollaborator(
  event: IpcMainInvokeEvent,
  { appId, username }: { appId: number; username: string },
): Promise<void> {
  try {
    // Validate username
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      throw new DyadError("Username cannot be empty.", DyadErrorKind.External);
    }
    if (trimmedUsername.length > 39) {
      throw new DyadError(
        "GitHub username cannot exceed 39 characters.",
        DyadErrorKind.Validation,
      );
    }
    // Single character usernames must be alphanumeric only
    if (trimmedUsername.length === 1) {
      if (!/^[a-zA-Z0-9]$/.test(trimmedUsername)) {
        throw new Error(
          "Invalid GitHub username format. Single-character usernames must be alphanumeric.",
        );
      }
    } else {
      // Multi-character usernames: alphanumeric start, can contain hyphens in middle, alphanumeric end
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(trimmedUsername)) {
        throw new Error(
          "Invalid GitHub username format. Usernames can only contain alphanumeric characters and hyphens, and cannot start or end with a hyphen.",
        );
      }
    }

    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new DyadError(
        "App is not linked to a GitHub repo.",
        DyadErrorKind.Precondition,
      );
    }

    // GitHub API to add a collaborator (sends an invitation)
    const response = await fetch(
      `${getGitHubApiBase()}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(trimmedUsername)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          permission: "push", // Default to write access
        }),
      },
    );

    if (!response.ok) {
      const data = (await response.json()) as { message?: string };
      throw new Error(
        data.message ||
          `Failed to invite collaborator: ${response.status} ${response.statusText}`,
      );
    }
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to invite collaborator:", err);
    throw new Error(err.message || "Failed to invite collaborator.");
  }
}

async function handleRemoveCollaborator(
  event: IpcMainInvokeEvent,
  { appId, username }: { appId: number; username: string },
): Promise<void> {
  try {
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new DyadError(
        "App is not linked to a GitHub repo.",
        DyadErrorKind.Precondition,
      );
    }

    const response = await fetch(
      `${getGitHubApiBase()}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(username)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const data = (await response.json()) as { message?: string };
      throw new Error(
        data.message ||
          `Failed to remove collaborator: ${response.status} ${response.statusText}`,
      );
    }
  } catch (err: any) {
    if (err instanceof DyadError) throw err;
    logger.error("[GitHub Handler] Failed to remove collaborator:", err);
    throw new Error(err.message || "Failed to remove collaborator.");
  }
}

async function handleGetMergeConflicts(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<string[]> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const conflicts = await gitGetMergeConflicts({ path: appPath });
  return conflicts;
}

async function handleDisconnectGithubRepo(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  logger.log(`Disconnecting GitHub repo for appId: ${appId}`);

  // Get the app from the database
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  // Update app in database to remove GitHub repo, org, and branch
  await db
    .update(apps)
    .set({
      githubRepo: null,
      githubOrg: null,
      githubBranch: null,
    })
    .where(eq(apps.id, appId));
}
// --- GitHub Clone Repo from URL Handler ---
async function handleCloneRepoFromUrl(
  event: IpcMainInvokeEvent,
  params: CloneRepoParams,
): Promise<CloneRepoResult> {
  const {
    url,
    installCommand,
    startCommand,
    appName,
    optimizeForDyad = true,
  } = params;
  try {
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    const urlPattern = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
    const match = url.match(urlPattern);
    if (!match) {
      return {
        error:
          "Invalid GitHub URL. Expected format: https://github.com/owner/repo.git",
      };
    }
    const [, owner, repoName] = match;
    if (accessToken) {
      const repoResponse = await fetch(
        `${getGitHubApiBase()}/repos/${owner}/${repoName}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (!repoResponse.ok) {
        return {
          error: "Repository not found or you do not have access to it.",
        };
      }
    }
    const finalAppName = appName && appName.trim() ? appName.trim() : repoName;
    const existingApp = await db.query.apps.findFirst({
      where: eq(apps.name, finalAppName),
    });

    if (existingApp) {
      return { error: `An app named "${finalAppName}" already exists.` };
    }

    const appPath = getDyadAppPath(finalAppName);

    if (!isAppLocationAccessible(appPath)) {
      throw new Error(
        `The path ${appPath} is inaccessible. Please check your custom apps folder setting.`,
      );
    }

    // Always clone with a credential-free URL; if a token exists it is
    // injected per-invocation in git_utils.
    const cloneUrl = `${getGitHubGitBase()}/${owner}/${repoName}.git`;
    try {
      await gitClone({
        path: appPath,
        url: cloneUrl,
        accessToken,
        singleBranch: false,
      });
    } catch (cloneErr) {
      logger.error("[GitHub Handler] Clone failed:", cloneErr);
      return {
        error:
          "Failed to clone repository. Please check the URL and try again.",
      };
    }
    const aiRulesPath = path.join(appPath, "AI_RULES.md");
    const hasAiRules = fs.existsSync(aiRulesPath);
    const [newApp] = await db
      .insert(schema.apps)
      .values({
        name: finalAppName,
        path: finalAppName,
        createdAt: new Date(),
        updatedAt: new Date(),
        githubOrg: owner,
        githubRepo: repoName,
        githubBranch: "main",
        installCommand: installCommand || null,
        startCommand: startCommand || null,
      })
      .returning();
    logger.log(`Successfully cloned repo ${owner}/${repoName} to ${appPath}`);

    let autoUpgradeWarning = false;
    if (optimizeForDyad && isComponentTaggerUpgradeNeeded(appPath)) {
      try {
        await applyComponentTagger(appPath, { installDependencies: false });
        logger.log(
          `Automatically applied component tagger upgrade for ${owner}/${repoName}`,
        );
      } catch (upgradeError) {
        // Auto-upgrade  Failures are logged but don't block import.
        // User will be notified via warning toast to manually upgrade if needed.
        autoUpgradeWarning = true;
        logger.warn(
          `Failed to auto-apply component tagger upgrade for ${owner}/${repoName}: `,
          upgradeError,
        );
      }
    }

    return {
      app: {
        ...newApp,
        files: [],
        supabaseProjectName: null,
        supabaseOrganizationSlug: null,
        vercelTeamSlug: null,
      },
      hasAiRules,
      autoUpgradeWarning,
    };
  } catch (err: any) {
    logger.error("[GitHub Handler] Unexpected error in clone flow:", err);
    return {
      error: err.message || "An unexpected error occurred during cloning.",
    };
  }
}

// --- Registration ---
export function registerGithubHandlers() {
  // The GitHub device flow is started/cancelled through the generic
  // connection-flow IPC (per-provider registry, flowId-correlated), so no
  // github-specific start handler remains.
  registerConnectionFlowProvider("github", {
    start: startGithubDeviceFlow,
    onFlowEnded: cleanupDeviceFlow,
  });

  createTypedHandler(githubContracts.listRepos, async () => {
    return handleListGithubRepos();
  });

  createTypedHandler(githubContracts.getRepoBranches, async (event, params) => {
    return handleGetRepoBranches(event, params);
  });

  createTypedHandler(githubContracts.isRepoAvailable, async (event, params) => {
    return handleIsRepoAvailable(event, params);
  });

  createTypedHandler(githubContracts.createRepo, async (event, params) => {
    return handleCreateRepo(event, params);
  });

  createTypedHandler(
    githubContracts.connectExistingRepo,
    async (event, params) => {
      return handleConnectToExistingRepo(event, params);
    },
  );

  createTypedHandler(githubContracts.push, async (event, params) => {
    return handlePushToGithub(event, params);
  });

  createTypedHandler(githubContracts.rebase, async (event, params) => {
    return handleRebaseFromGithub(event, params);
  });

  createTypedHandler(githubContracts.rebaseAbort, async (event, params) => {
    return handleAbortRebase(event, params);
  });

  createTypedHandler(githubContracts.rebaseContinue, async (event, params) => {
    return handleContinueRebase(event, params);
  });

  createTypedHandler(
    githubContracts.listCollaborators,
    async (event, params) => {
      return handleListCollaborators(event, params);
    },
  );

  createTypedHandler(
    githubContracts.inviteCollaborator,
    async (event, params) => {
      return handleInviteCollaborator(event, params);
    },
  );

  createTypedHandler(
    githubContracts.removeCollaborator,
    async (event, params) => {
      return handleRemoveCollaborator(event, params);
    },
  );

  createTypedHandler(githubContracts.getConflicts, async (event, params) => {
    return handleGetMergeConflicts(event, params);
  });

  createTypedHandler(githubContracts.getGitState, async (event, params) => {
    return handleGetGitState(event, params);
  });

  createTypedHandler(githubContracts.disconnect, async (event, params) => {
    return handleDisconnectGithubRepo(event, params);
  });

  createTypedHandler(
    githubContracts.cloneRepoFromUrl,
    async (event, params) => {
      return handleCloneRepoFromUrl(event, params);
    },
  );
}

export async function updateAppGithubRepo({
  appId,
  org,
  repo,
  branch,
}: {
  appId: number;
  org?: string;
  repo: string;
  branch?: string;
}): Promise<void> {
  await db
    .update(schema.apps)
    .set({
      githubOrg: org,
      githubRepo: repo,
      githubBranch: branch || "main",
    })
    .where(eq(schema.apps.id, appId));
}
