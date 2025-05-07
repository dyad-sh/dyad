import {
  ipcMain,
  IpcMainEvent,
  BrowserWindow,
  IpcMainInvokeEvent,
} from "electron";
import fetch from "node-fetch"; // Use node-fetch for making HTTP requests in main process
import { writeSettings, readSettings } from "../../main/settings";
import { updateAppGithubRepo } from "../../db/index";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import path from "node:path";
import fs from "node:fs";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { GithubUser } from "../../lib/schemas";
import log from "electron-log";

const logger = log.scope("github_handlers");

// --- GitHub Device Flow Constants ---
// TODO: Fetch this securely, e.g., from environment variables or a config file
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "Ov23liWV2HdC0RBLecWx";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
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
    const res = await fetch("https://api.github.com/user/emails", {
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

// --- GitHub Repo Availability Handler ---
async function handleIsRepoAvailable(
  event: IpcMainInvokeEvent,
  { org, repo }: { org: string; repo: string },
) {
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
      (await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => r.json())
        .then((u) => u.login));
    // Check if repo exists
    const url = `https://api.github.com/repos/${owner}/${repo}`;
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
  { org, repo, appId }: { org: string; repo: string; appId: number },
) {
  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      return { success: false, error: "Not authenticated with GitHub." };
    }
    // If org is empty, create for the authenticated user
    let owner = org;
    if (!owner) {
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await userRes.json();
      owner = user.login;
    }
    // Create repo
    const createUrl = org
      ? `https://api.github.com/orgs/${owner}/repos`
      : `https://api.github.com/user/repos`;
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
      const data = await res.json();
      return { success: false, error: data.message || "Failed to create repo" };
    }
    // Store org and repo in the app's DB row (apps table)
    await updateAppGithubRepo(appId, owner, repo);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Unknown error" };
  }
}

// --- GitHub Push Handler ---
async function handlePushToGithub(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
) {
  try {
    // Get access token from settings
    const settings = readSettings();
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) {
      return { success: false, error: "Not authenticated with GitHub." };
    }
    // Get app info from DB
    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.githubOrg || !app.githubRepo) {
      return { success: false, error: "App is not linked to a GitHub repo." };
    }
    const appPath = getDyadAppPath(app.path);
    // Set up remote URL with token
    const remoteUrl = `https://${accessToken}:x-oauth-basic@github.com/${app.githubOrg}/${app.githubRepo}.git`;
    // Set or update remote URL using git config
    await git.setConfig({
      fs,
      dir: appPath,
      path: "remote.origin.url",
      value: remoteUrl,
    });
    // Push to GitHub
    await git.push({
      fs,
      http,
      dir: appPath,
      remote: "origin",
      ref: "main",
      onAuth: () => ({
        username: accessToken,
        password: "x-oauth-basic",
      }),
      force: false,
    });
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to push to GitHub.",
    };
  }
}

async function handleDisconnectGithubRepo(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
) {
  try {
    logger.log(`Disconnecting GitHub repo for appId: ${appId}`);

    // Get the app from the database
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      return { success: false, error: "App not found" };
    }

    // Update app in database to remove GitHub repo and org
    await db
      .update(apps)
      .set({
        githubRepo: null,
        githubOrg: null,
      })
      .where(eq(apps.id, appId));

    return { success: true };
  } catch (error) {
    logger.error(`Error disconnecting GitHub repo: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- Registration ---
export function registerGithubHandlers() {
  ipcMain.handle("github:start-flow", handleStartGithubFlow);
  ipcMain.handle("github:is-repo-available", handleIsRepoAvailable);
  ipcMain.handle("github:create-repo", handleCreateRepo);
  ipcMain.handle("github:push", handlePushToGithub);
  ipcMain.handle("github:disconnect", (event, args: { appId: number }) =>
    handleDisconnectGithubRepo(event, args),
  );
}
