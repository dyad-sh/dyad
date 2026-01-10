import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from "electron";
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
  gitMergeAbort,
  gitFetch,
  gitCreateBranch,
  gitDeleteBranch,
  gitCheckout,
  gitMerge,
  gitGetMergeConflicts,
  gitCurrentBranch,
  gitListBranches,
  gitListRemoteBranches,
  gitRenameBranch,
  gitAddAll,
  gitCommit,
  isGitStatusClean,
  getGitUncommittedFiles,
  getCurrentCommitHash,
  GitStateError,
  GIT_ERROR_CODES,
  isGitMergeInProgress,
  isGitRebaseInProgress,
  gitReset,
  GitConflictError,
} from "../utils/git_utils";
import * as schema from "../../db/schema";
import fs from "node:fs";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import type { CloneRepoParams, CloneRepoReturnType } from "@/ipc/ipc_types";
import { eq } from "drizzle-orm";
import { GithubUser } from "../../lib/schemas";
import log from "electron-log";
import { IS_TEST_BUILD } from "../utils/test_utils";
import path from "node:path";
import { withLock } from "../utils/lock_utils";

const logger = log.scope("github_handlers");

// --- GitHub Device Flow Constants ---
// TODO: Fetch this securely, e.g., from environment variables or a config file
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "Ov23liWV2HdC0RBLecWx";

// Use test server URLs when in test mode

const TEST_SERVER_BASE = "http://localhost:3500";

const GITHUB_DEVICE_CODE_URL = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/github/login/device/code`
  : "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/github/login/oauth/access_token`
  : "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/github/api`
  : "https://api.github.com";
const GITHUB_GIT_BASE = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/github/git`
  : "https://github.com";

const GITHUB_SCOPES = "repo,user,workflow"; // Define the scopes needed

// --- State Management (Simple in-memory, consider alternatives for robustness) ---
interface DeviceFlowState {
  deviceCode: string;
  interval: number;
  timeoutId: NodeJS.Timeout | null;
  isPolling: boolean;
  window: BrowserWindow | null; // Reference to the window that initiated the flow
}

// Simple map to track ongoing flows (key could be appId or a unique flow ID if needed)
// For simplicity, let's assume only one flow can happen at a time for now.
let currentFlowState: DeviceFlowState | null = null;

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
    const res = await fetch(`${GITHUB_API_BASE}/user/emails`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const emails = await res.json();
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

/**
 * Ensures the git workspace is clean by auto-committing uncommitted changes if necessary.
 * This helper function eliminates code duplication across multiple handlers.
 *
 * @param appPath - The path to the application directory
 * @param operationDescription - Description of the operation for commit messages (e.g., "preparing branch 'main'", "rebase", "switching to branch 'feature'")
 * @throws Error if native Git is disabled and workspace is not clean, or if commit fails
 */
async function ensureCleanWorkspace(
  appPath: string,
  operationDescription: string,
): Promise<void> {
  const isClean = await isGitStatusClean({ path: appPath });
  if (!isClean) {
    const settings = readSettings();
    if (!settings.enableNativeGit) {
      throw new Error(
        "Cannot auto-commit changes because native Git is disabled, and the repository is not clean. " +
          "Please commit or stash your changes manually and try again.",
      );
    }
    let filesStaged = false;
    try {
      const uncommittedFiles = await getGitUncommittedFiles({
        path: appPath,
      });
      // Stage all changes
      await gitAddAll({ path: appPath });
      filesStaged = true; // Mark that staging succeeded
      // Commit with a descriptive message
      await gitCommit({
        path: appPath,
        message: `[dyad] Auto-commit before ${operationDescription}: ${uncommittedFiles.length} file(s) changed`,
      });
      logger.log(
        `Auto-committed ${uncommittedFiles.length} file(s) before ${operationDescription}`,
      );
    } catch (commitError: any) {
      // Reset staging area if files were staged but commit failed
      // This ensures cleanup always happens, preventing inconsistent repository state
      if (filesStaged) {
        try {
          await gitReset({ path: appPath });
        } catch (resetError) {
          // If reset fails, log the error and enhance the error message to inform user
          logger.error(
            `Failed to reset staging area after commit failure. Files remain staged. ` +
              `Original error: ${commitError?.message || "Unknown error"}, ` +
              `Reset error: ${resetError}`,
          );
          throw new Error(
            `Failed to commit uncommitted changes before ${operationDescription}: ${commitError?.message || "Unknown error"}. ` +
              "Additionally, failed to unstage files - your files are currently staged but not committed. " +
              "Please manually unstage using 'git reset HEAD' or commit/stash your changes and try again.",
          );
        }
      }
      // Throw the original error after successful cleanup
      const cleanupMessage = filesStaged
        ? "Your changes have been unstaged. Please review and commit or stash them manually, then try again."
        : "Please commit or stash your changes manually and try again.";
      throw new Error(
        `Failed to commit uncommitted changes before ${operationDescription}: ${commitError?.message || "Unknown error"}. ` +
          cleanupMessage,
      );
    }
  }
}

async function prepareLocalBranch({
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
    throw new Error("App not found");
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
    // The lock covers the entire branch preparation: auto-commit, branch listing, and checkout operations
    // This ensures atomicity and prevents conflicts between concurrent operations
    await withLock(appId, async () => {
      // Check for uncommitted changes and commit them before checkout
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
          // For native git: create branch with tracking
          // For isomorphic-git: checkout remote branch directly (creates tracking branch automatically)
          const settings = readSettings();
          if (settings.enableNativeGit) {
            // Native git: create branch from remote with tracking
            await gitCreateBranch({
              path: appPath,
              branch: targetBranch,
              from: `origin/${targetBranch}`,
            });
            await gitCheckout({ path: appPath, ref: targetBranch });
          } else {
            // isomorphic-git: create local branch from the remote commit and checkout so branch name matches native git
            // gitCreateBranch does not support 'from' when native git is disabled, so resolve the remote ref's commit
            // and create the local branch at that commit.
            const remoteRef = `refs/remotes/origin/${targetBranch}`;
            let commitSha: string;
            try {
              commitSha = await getCurrentCommitHash({
                path: appPath,
                ref: remoteRef,
              });
            } catch {
              // Fallback to short remote ref name if the full refs path isn't present
              try {
                commitSha = await getCurrentCommitHash({
                  path: appPath,
                  ref: `origin/${targetBranch}`,
                });
              } catch (innerErr: any) {
                throw new Error(
                  `Failed to resolve remote branch 'origin/${targetBranch}' to a commit. ` +
                    "Ensure 'git fetch' succeeded and the remote branch exists. " +
                    `${innerErr?.message || String(innerErr)}`,
                );
              }
            }

            // Checkout the remote commit (detached HEAD), create branch at that commit, then checkout the branch
            await gitCheckout({ path: appPath, ref: commitSha });
            await gitCreateBranch({ path: appPath, branch: targetBranch });
            await gitCheckout({ path: appPath, ref: targetBranch });
          }
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
// function event.sender.send(channel: string, data: any) {
//   if (currentFlowState?.window && !currentFlowState.window.isDestroyed()) {
//     currentFlowState.window.webContents.send(channel, data);
//   }
// }

async function pollForAccessToken(event: IpcMainInvokeEvent) {
  if (!currentFlowState || !currentFlowState.isPolling) {
    logger.debug("[GitHub Handler] Polling stopped or no active flow.");
    return;
  }

  const { deviceCode, interval } = currentFlowState;

  logger.debug("[GitHub Handler] Polling for token with device code");
  event.sender.send("github:flow-update", {
    message: "Polling GitHub for authorization...",
  });

  try {
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    if (response.ok && data.access_token) {
      logger.log("Successfully obtained GitHub Access Token.");
      event.sender.send("github:flow-success", {
        message: "Successfully connected!",
      });
      writeSettings({
        githubAccessToken: {
          value: data.access_token,
        },
      });

      stopPolling();
      return;
    } else if (data.error) {
      switch (data.error) {
        case "authorization_pending":
          logger.debug("Authorization pending...");
          event.sender.send("github:flow-update", {
            message: "Waiting for user authorization...",
          });
          // Schedule next poll
          currentFlowState.timeoutId = setTimeout(
            () => pollForAccessToken(event),
            interval * 1000,
          );
          break;
        case "slow_down":
          const newInterval = interval + 5;
          logger.debug(`Slow down requested. New interval: ${newInterval}s`);
          currentFlowState.interval = newInterval; // Update interval
          event.sender.send("github:flow-update", {
            message: `GitHub asked to slow down. Retrying in ${newInterval}s...`,
          });
          currentFlowState.timeoutId = setTimeout(
            () => pollForAccessToken(event),
            newInterval * 1000,
          );
          break;
        case "expired_token":
          logger.error("Device code expired.");
          event.sender.send("github:flow-error", {
            error: "Verification code expired. Please try again.",
          });
          stopPolling();
          break;
        case "access_denied":
          logger.error("Access denied by user.");
          event.sender.send("github:flow-error", {
            error: "Authorization denied by user.",
          });
          stopPolling();
          break;
        default:
          logger.error(
            `Unknown GitHub error: ${data.error_description || data.error}`,
          );
          event.sender.send("github:flow-error", {
            error: `GitHub authorization error: ${
              data.error_description || data.error
            }`,
          });
          stopPolling();
          break;
      }
    } else {
      throw new Error(`Unknown response structure: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    logger.error("Error polling for GitHub access token:", error);
    event.sender.send("github:flow-error", {
      error: `Network or unexpected error during polling: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    stopPolling();
  }
}

function stopPolling() {
  if (currentFlowState) {
    if (currentFlowState.timeoutId) {
      clearTimeout(currentFlowState.timeoutId);
    }
    currentFlowState.isPolling = false;
    currentFlowState.timeoutId = null;

    logger.debug("[GitHub Handler] Polling stopped.");
  }
}

// --- IPC Handlers ---

function handleStartGithubFlow(
  event: IpcMainInvokeEvent,
  args: { appId: number | null },
) {
  logger.debug(`Received github:start-flow for appId: ${args.appId}`);

  // If a flow is already in progress, maybe cancel it or send an error
  if (currentFlowState && currentFlowState.isPolling) {
    logger.warn("Another GitHub flow is already in progress.");
    event.sender.send("github:flow-error", {
      error: "Another connection process is already active.",
    });
    return;
  }

  // Store the window that initiated the request
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    logger.error("Could not get BrowserWindow instance.");
    return;
  }

  currentFlowState = {
    deviceCode: "",
    interval: 5, // Default interval
    timeoutId: null,
    isPolling: false,
    window: window,
  };

  event.sender.send("github:flow-update", {
    message: "Requesting device code from GitHub...",
  });

  fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPES,
    }),
  })
    .then((res) => {
      if (!res.ok) {
        return res.json().then((errData) => {
          throw new Error(
            `GitHub API Error: ${errData.error_description || res.statusText}`,
          );
        });
      }
      return res.json();
    })
    .then((data) => {
      logger.info("Received device code response");
      if (!currentFlowState) return; // Flow might have been cancelled

      currentFlowState.deviceCode = data.device_code;
      currentFlowState.interval = data.interval || 5;
      currentFlowState.isPolling = true;

      // Send user code and verification URI to renderer
      event.sender.send("github:flow-update", {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        message: "Please authorize in your browser.",
      });

      // Start polling after the initial interval
      currentFlowState.timeoutId = setTimeout(
        () => pollForAccessToken(event),
        currentFlowState.interval * 1000,
      );
    })
    .catch((error) => {
      logger.error("Error initiating GitHub device flow:", error);
      event.sender.send("github:flow-error", {
        error: `Failed to start GitHub connection: ${error.message}`,
      });
      stopPolling(); // Ensure polling stops on initial error
      currentFlowState = null; // Clear state on initial error
    });
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
      throw new Error("Not authenticated with GitHub.");
    }

    // Fetch user's repositories
    const response = await fetch(
      `${GITHUB_API_BASE}/user/repos?per_page=100&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `GitHub API error: ${errorData.message || response.statusText}`,
      );
    }

    const repos = await response.json();
    return repos.map((repo: any) => ({
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
    }));
  } catch (err: any) {
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
      throw new Error("Not authenticated with GitHub.");
    }

    // Fetch repository branches
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `GitHub API error: ${errorData.message || response.statusText}`,
      );
    }

    const branches = await response.json();
    return branches.map((branch: any) => ({
      name: branch.name,
      commit: { sha: branch.commit.sha },
    }));
  } catch (err: any) {
    logger.error("[GitHub Handler] Failed to get repo branches:", err);
    throw new Error(err.message || "Failed to get repository branches.");
  }
}

// --- GitHub Repo Availability Handler ---
async function handleIsRepoAvailable(
  event: IpcMainInvokeEvent,
  { org, repo }: { org: string; repo: string },
): Promise<{ available: boolean; error?: string }> {
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
      (await fetch(`${GITHUB_API_BASE}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => r.json())
        .then((u) => u.login));
    // Check if repo exists
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      return { available: true };
    } else if (res.ok) {
      return { available: false, error: "Repository already exists." };
    } else {
      const data = await res.json();
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
  // Get access token from settings
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new Error("Not authenticated with GitHub.");
  }
  // If org is empty, create for the authenticated user
  let owner = org;
  if (!owner) {
    const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = await userRes.json();
    owner = user.login;
  }
  // Create repo
  const createUrl = org
    ? `${GITHUB_API_BASE}/orgs/${owner}/repos`
    : `${GITHUB_API_BASE}/user/repos`;
  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      name: repo,
      private: true,
    }),
  });
  if (!res.ok) {
    let errorMessage = `Failed to create repository (${res.status} ${res.statusText})`;
    try {
      const data = await res.json();
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

  // Set up remote URL before preparing branch
  const remoteUrl = IS_TEST_BUILD
    ? `${GITHUB_GIT_BASE}/${owner}/${repo}.git`
    : `https://${accessToken}:x-oauth-basic@github.com/${owner}/${repo}.git`;

  // Prepare local branch with remote URL set up
  await prepareLocalBranch({
    appId,
    branch,
    remoteUrl,
    accessToken,
  });

  // Store org, repo, and branch in the app's DB row (apps table)
  await updateAppGithubRepo({ appId, org: owner, repo, branch });
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
      throw new Error("Not authenticated with GitHub.");
    }

    // Verify the repository exists and user has access
    const repoResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!repoResponse.ok) {
      const errorData = await repoResponse.json();
      throw new Error(
        `Repository not found or access denied: ${errorData.message}`,
      );
    }

    // Set up remote URL before preparing branch
    const remoteUrl = IS_TEST_BUILD
      ? `${GITHUB_GIT_BASE}/${owner}/${repo}.git`
      : `https://${accessToken}:x-oauth-basic@github.com/${owner}/${repo}.git`;

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
    throw new Error("Not authenticated with GitHub.");
  }

  // Get app info from DB
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new Error("App is not linked to a GitHub repo.");
  }
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch || "main";

  // Set up remote URL with token
  const remoteUrl = IS_TEST_BUILD
    ? `${GITHUB_GIT_BASE}/${app.githubOrg}/${app.githubRepo}.git`
    : `https://${accessToken}:x-oauth-basic@github.com/${app.githubOrg}/${app.githubRepo}.git`;
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
        errorMessage.includes("conflict") ||
        errorMessage.includes("Merge conflict") ||
        errorMessage.includes("Fetch_head") ||
        errorMessage.includes("preimage")
      ) {
        throw GitConflictError(
          "Merge conflict detected during pull. Please resolve conflicts before pushing.",
        );
      }

      // Check if it's a missing remote branch error
      const isMissingRemoteBranch =
        pullError?.code === "MissingRefError" ||
        pullError?.code === "NotFoundError" ||
        errorMessage.includes("couldn't find remote ref") ||
        errorMessage.includes("not found") ||
        // isomorphic-git throws a TypeError when the remote repo is empty
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

async function handleAbortMerge(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitMergeAbort({ path: appPath });
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
    throw new Error("Not authenticated with GitHub.");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new Error("App is not linked to a GitHub repo.");
  }
  const appPath = getDyadAppPath(app.path);
  const branch = app.githubBranch || "main";

  // Set up remote URL with token
  const remoteUrl = IS_TEST_BUILD
    ? `${GITHUB_GIT_BASE}/${app.githubOrg}/${app.githubRepo}.git`
    : `https://${accessToken}:x-oauth-basic@github.com/${app.githubOrg}/${app.githubRepo}.git`;
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

// --- GitHub Fetch Handler ---
async function handleFetchFromGithub(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<void> {
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new Error("Not authenticated with GitHub.");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new Error("App is not linked to a GitHub repo.");
  }
  const appPath = getDyadAppPath(app.path);

  await gitFetch({
    path: appPath,
    remote: "origin",
    accessToken,
  });
}

// --- GitHub Branch Handlers ---

async function handleCreateBranch(
  event: IpcMainInvokeEvent,
  { appId, branch, from }: { appId: number; branch: string; from?: string },
): Promise<void> {
  // Validate branch name
  if (!branch || branch.length === 0 || branch.length > 255) {
    throw new Error("Branch name must be between 1 and 255 characters");
  }
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branch) || /\.\./.test(branch)) {
    throw new Error("Branch name contains invalid characters");
  }
  if (
    branch.startsWith("-") ||
    branch === "HEAD" ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("@{")
  ) {
    throw new Error("Invalid branch name");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitCreateBranch({
    path: appPath,
    branch,
    from,
  });
}

async function handleDeleteBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: { appId: number; branch: string },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitDeleteBranch({
    path: appPath,
    branch,
  });
}

async function handleSwitchBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: { appId: number; branch: string },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check for merge or rebase in progress before attempting to switch
  // This provides structured error codes instead of relying on string matching
  if (isGitMergeInProgress({ path: appPath })) {
    throw GitStateError(
      "Cannot switch branches: merge in progress. Please complete or abort the merge first.",
      GIT_ERROR_CODES.MERGE_IN_PROGRESS,
    );
  }

  if (isGitRebaseInProgress({ path: appPath })) {
    throw GitStateError(
      "Cannot switch branches: rebase in progress. Please complete or abort the rebase first.",
      GIT_ERROR_CODES.REBASE_IN_PROGRESS,
    );
  }

  // Check for uncommitted changes and commit them before switching branches
  await withLock(appId, async () => {
    await ensureCleanWorkspace(appPath, `switching to branch '${branch}'`);
  });
  try {
    await gitCheckout({
      path: appPath,
      ref: branch,
    });
  } catch (checkoutError: any) {
    const errorMessage = checkoutError?.message || "Failed to switch branch.";
    // Check if error is about uncommitted changes (fallback in case check above missed it)
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes("local changes") ||
      lowerMessage.includes("would be overwritten") ||
      lowerMessage.includes("please commit or stash")
    ) {
      throw new Error(
        `Failed to switch branch: uncommitted changes detected. ` +
          "Attempting to commit automatically failed. Please commit or stash your changes manually and try again.",
      );
    }
    throw checkoutError;
  }

  // Update DB with new branch
  await updateAppGithubRepo({
    appId,
    org: app.githubOrg || undefined,
    repo: app.githubRepo || "",
    branch,
  });
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

async function handleRenameBranch(
  event: IpcMainInvokeEvent,
  {
    appId,
    oldBranch,
    newBranch,
  }: { appId: number; oldBranch: string; newBranch: string },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check if we're renaming the current branch BEFORE renaming to avoid race conditions
  const currentBranch = await gitCurrentBranch({ path: appPath });
  const isRenamingCurrentBranch = currentBranch === oldBranch;

  await gitRenameBranch({
    path: appPath,
    oldBranch,
    newBranch,
  });

  // Only update DB if we were on oldBranch before renaming
  // (git branch -m renames the current branch if we're on it, so HEAD now points to newBranch)
  if (isRenamingCurrentBranch) {
    await updateAppGithubRepo({
      appId,
      org: app.githubOrg || undefined,
      repo: app.githubRepo || "",
      branch: newBranch,
    });
  }
}

// Custom error class for merge conflicts
class MergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeConflictError";
  }
}

async function handleMergeBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: { appId: number; branch: string },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check if branch exists locally, if not, check if it's a remote branch
  const localBranches = await gitListBranches({ path: appPath });
  let remoteBranches: string[] = [];
  try {
    remoteBranches = await gitListRemoteBranches({
      path: appPath,
    });
  } catch (error: any) {
    logger.warn(`Failed to list remote branches: ${error.message}`);
    // Continue with empty remote branches list
  }

  let mergeBranchRef = branch;

  // If branch doesn't exist locally but exists remotely, use remote ref
  if (!localBranches.includes(branch) && remoteBranches.includes(branch)) {
    mergeBranchRef = `origin/${branch}`;
  }

  // Check for uncommitted changes and commit them before merging
  await withLock(appId, async () => {
    await ensureCleanWorkspace(appPath, `merging branch '${branch}'`);
  });
  try {
    await gitMerge({
      path: appPath,
      branch: mergeBranchRef,
    });
  } catch (mergeError: any) {
    const errorMessage = mergeError?.message || "Failed to merge branch.";
    const lowerMessage = errorMessage.toLowerCase();
    const isConflict =
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("merge conflict");

    // Check if error is about uncommitted changes (fallback in case check above missed it)
    if (
      (lowerMessage.includes("local changes") ||
        lowerMessage.includes("would be overwritten") ||
        lowerMessage.includes("please commit or stash")) &&
      !isConflict
    ) {
      throw new Error(
        `Failed to merge branch: uncommitted changes detected. ` +
          "Attempting to commit automatically failed. Please commit or stash your changes manually and try again.",
      );
    }

    // If it's a conflict, throw MergeConflictError
    if (isConflict) {
      throw new MergeConflictError(errorMessage);
    }

    // Otherwise, throw the original error
    throw mergeError;
  }
}

async function handleListLocalBranches(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<{ branches: string[]; current: string | null }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const branches = await gitListBranches({ path: appPath });
  const current = await gitCurrentBranch({ path: appPath });
  return { branches, current: current || null };
}

async function handleListRemoteBranches(
  event: IpcMainInvokeEvent,
  { appId, remote = "origin" }: { appId: number; remote?: string },
): Promise<string[]> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const branches = await gitListRemoteBranches({ path: appPath, remote });
  return branches;
}

async function handleListCollaborators(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<{ login: string; avatar_url: string; permissions: any }[]> {
  try {
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      throw new Error("Not authenticated with GitHub.");
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new Error("App is not linked to a GitHub repo.");
    }

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${app.githubOrg}/${app.githubRepo}/collaborators`,
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

    const collaborators = await response.json();
    return collaborators.map((c: any) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      permissions: c.permissions,
    }));
  } catch (err: any) {
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
      throw new Error("Username cannot be empty.");
    }
    if (trimmedUsername.length > 39) {
      throw new Error("GitHub username cannot exceed 39 characters.");
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
      throw new Error("Not authenticated with GitHub.");
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new Error("App is not linked to a GitHub repo.");
    }

    // GitHub API to add a collaborator (sends an invitation)
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(trimmedUsername)}`,
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
      const data = await response.json();
      throw new Error(
        data.message ||
          `Failed to invite collaborator: ${response.status} ${response.statusText}`,
      );
    }
  } catch (err: any) {
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
      throw new Error("Not authenticated with GitHub.");
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      throw new Error("App is not linked to a GitHub repo.");
    }

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(username)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(
        data.message ||
          `Failed to remove collaborator: ${response.status} ${response.statusText}`,
      );
    }
  } catch (err: any) {
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
    throw new Error("App not found");
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
): Promise<CloneRepoReturnType> {
  const { url, installCommand, startCommand, appName } = params;
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
        `${GITHUB_API_BASE}/repos/${owner}/${repoName}`,
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
    // Ensure the app directory exists if native git is disabled
    if (!settings.enableNativeGit) {
      if (!fs.existsSync(appPath)) {
        fs.mkdirSync(appPath, { recursive: true });
      }
    }
    // Use authenticated URL if token exists, otherwise use public HTTPS URL
    const cloneUrl = accessToken
      ? IS_TEST_BUILD
        ? `${GITHUB_GIT_BASE}/${owner}/${repoName}.git`
        : `https://${accessToken}:x-oauth-basic@github.com/${owner}/${repoName}.git`
      : `https://github.com/${owner}/${repoName}.git`; // Changed: use public HTTPS URL instead of original url
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
    // Return success object
    return {
      app: {
        ...newApp,
        files: [],
        supabaseProjectName: null,
        supabaseOrganizationSlug: null,
        vercelTeamSlug: null,
      },
      hasAiRules,
    };
  } catch (err: any) {
    // Catch any remaining unexpected errors and return an error object
    logger.error("[GitHub Handler] Unexpected error in clone flow:", err);
    return {
      error: err.message || "An unexpected error occurred during cloning.",
    };
  }
}

// --- Registration ---
export function registerGithubHandlers() {
  ipcMain.handle("github:start-flow", handleStartGithubFlow);
  ipcMain.handle("github:list-repos", handleListGithubRepos);
  ipcMain.handle(
    "github:get-repo-branches",
    (event, args: { owner: string; repo: string }) =>
      handleGetRepoBranches(event, args),
  );
  ipcMain.handle("github:is-repo-available", handleIsRepoAvailable);
  ipcMain.handle("github:create-repo", handleCreateRepo);
  ipcMain.handle(
    "github:connect-existing-repo",
    (
      event,
      args: { owner: string; repo: string; branch: string; appId: number },
    ) => handleConnectToExistingRepo(event, args),
  );
  ipcMain.handle("github:rebase", handleRebaseFromGithub);
  ipcMain.handle("github:push", handlePushToGithub);
  ipcMain.handle("github:rebase-abort", handleAbortRebase);
  ipcMain.handle("github:merge-abort", handleAbortMerge);
  ipcMain.handle("github:rebase-continue", handleContinueRebase);
  ipcMain.handle("github:fetch", handleFetchFromGithub);
  ipcMain.handle("github:create-branch", handleCreateBranch);
  ipcMain.handle("github:delete-branch", handleDeleteBranch);
  ipcMain.handle("github:switch-branch", handleSwitchBranch);
  ipcMain.handle("github:rename-branch", handleRenameBranch);
  ipcMain.handle("github:merge-branch", handleMergeBranch);
  ipcMain.handle("github:list-local-branches", handleListLocalBranches);
  ipcMain.handle("github:list-remote-branches", handleListRemoteBranches);
  ipcMain.handle("github:list-collaborators", handleListCollaborators);
  ipcMain.handle("github:invite-collaborator", handleInviteCollaborator);
  ipcMain.handle("github:remove-collaborator", handleRemoveCollaborator);
  ipcMain.handle("github:get-conflicts", handleGetMergeConflicts);
  ipcMain.handle("github:get-git-state", handleGetGitState);
  ipcMain.handle("github:disconnect", (event, args: { appId: number }) =>
    handleDisconnectGithubRepo(event, args),
  );
  ipcMain.handle(
    "github:clone-repo-from-url",
    async (event, args: CloneRepoParams) => {
      return await handleCloneRepoFromUrl(event, args);
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
