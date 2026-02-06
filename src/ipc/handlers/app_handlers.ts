import { ipcMain, app, dialog } from "electron";
import { db, getDatabasePath } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, like } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { appContracts } from "../types/app";
import type { AppFileSearchResult } from "../types/app";
import { miscContracts } from "../types/misc";
import { systemContracts } from "../types/system";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath, getUserDataPath } from "../../paths/paths";
import { ChildProcess, spawn } from "node:child_process";
import { promises as fsPromises } from "node:fs";

// Import our utility modules
import { withLock } from "../utils/lock_utils";
import { getFilesRecursively } from "../utils/file_utils";
import {
  runningApps,
  processCounter,
  removeAppIfCurrentProcess,
  stopAppByInfo,
  removeDockerVolumesForApp,
} from "../utils/process_manager";
import { getEnvVar } from "../utils/read_env";
import { readSettings } from "../../main/settings";
import { addLog, clearLogs } from "../../lib/log_store";

import fixPath from "fix-path";

import killPort from "kill-port";
import util from "util";
import log from "electron-log";
import {
  deploySupabaseFunction,
  getSupabaseProjectName,
} from "../../supabase_admin/supabase_management_client";
import { createLoggedHandler } from "./safe_handle";
import { getLanguageModelProviders } from "../shared/language_model_helpers";
import { startProxy } from "../utils/start_proxy_server";
import { Worker } from "worker_threads";
import { createFromTemplate } from "./createFromTemplate";
import {
  gitCommit,
  gitAdd,
  gitInit,
  gitListBranches,
  gitRenameBranch,
} from "../utils/git_utils";
import { safeSend } from "../utils/safe_sender";
import { normalizePath } from "../../../shared/normalizePath";
import {
  isServerFunction,
  isSharedServerModule,
  deployAllSupabaseFunctions,
  extractFunctionNameFromPath,
} from "@/supabase_admin/supabase_utils";
import { getVercelTeamSlug } from "../utils/vercel_utils";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";
import { AppSearchResult } from "@/lib/schemas";

import { getAppPort } from "../../../shared/ports";
import {
  getRgExecutablePath,
  MAX_FILE_SEARCH_SIZE,
  RIPGREP_EXCLUDED_GLOBS,
} from "../utils/ripgrep_utils";

const logger = log.scope("app_handlers");
const handle = createLoggedHandler(logger);

function sanitizeSnippetText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Converts a byte offset in UTF-8 encoded string to a character index.
 * Ripgrep provides byte offsets, but JavaScript strings use character indices.
 * This handles multi-byte UTF-8 characters (emojis, CJK, accented characters) correctly.
 */
function byteOffsetToCharIndex(text: string, byteOffset: number): number {
  // Cap the byte offset to the actual byte length of the string
  const totalBytes = Buffer.from(text, "utf8").length;
  const safeByteOffset = Math.min(byteOffset, totalBytes);

  // Find the character index by checking byte counts at each position
  // This correctly handles multi-byte characters
  for (let i = 0; i <= text.length; i++) {
    const bytesUpToIndex = Buffer.from(text.slice(0, i), "utf8").length;
    if (bytesUpToIndex >= safeByteOffset) {
      return i;
    }
  }

  return text.length;
}

function buildSnippetFromMatch({
  lineText,
  start,
  end,
  lineNumber,
}: {
  lineText: string;
  start: number;
  end: number;
  lineNumber: number;
}): NonNullable<AppFileSearchResult["snippets"]>[number] {
  const safeLine = lineText.replace(/\r?\n$/, "");
  // Convert byte offsets to character indices for proper UTF-8 handling
  const startChar = byteOffsetToCharIndex(safeLine, start);
  const endChar = byteOffsetToCharIndex(safeLine, end);
  const before = sanitizeSnippetText(safeLine.slice(0, startChar));
  const match = sanitizeSnippetText(safeLine.slice(startChar, endChar));
  const after = sanitizeSnippetText(safeLine.slice(endChar));

  return {
    before,
    match,
    after,
    line: lineNumber,
  };
}

function getDefaultCommand(appId: number): string {
  const port = getAppPort(appId);
  return `(pnpm install && pnpm run dev --port ${port}) || (npm install --legacy-peer-deps && npm run dev -- --port ${port})`;
}
async function copyDir(
  source: string,
  destination: string,
  filter?: (source: string) => boolean,
  options?: { excludeNodeModules?: boolean },
) {
  await fsPromises.cp(source, destination, {
    recursive: true,
    filter: (src: string) => {
      if (
        options?.excludeNodeModules &&
        path.basename(src) === "node_modules"
      ) {
        return false;
      }
      if (filter) {
        return filter(src);
      }
      return true;
    },
  });
}

let proxyWorker: Worker | null = null;

// Needed, otherwise electron in MacOS/Linux will not be able
// to find node/pnpm.
fixPath();

async function executeApp({
  appPath,
  appId,
  event, // Keep event for local-node case
  isNeon,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  if (proxyWorker) {
    proxyWorker.terminate();
    proxyWorker = null;
  }
  const settings = readSettings();
  const runtimeMode = settings.runtimeMode2 ?? "host";

  if (runtimeMode === "docker") {
    await executeAppInDocker({
      appPath,
      appId,
      event,
      isNeon,
      installCommand,
      startCommand,
    });
  } else {
    await executeAppLocalNode({
      appPath,
      appId,
      event,
      isNeon,
      installCommand,
      startCommand,
    });
  }
}

async function executeAppLocalNode({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  const command = getCommand({ appId, installCommand, startCommand });
  const spawnedProcess = spawn(command, [], {
    cwd: appPath,
    shell: true,
    stdio: "pipe", // Ensure stdio is piped so we can capture output/errors and detect close
    detached: false, // Ensure child process is attached to the main process lifecycle unless explicitly backgrounded
  });

  // Check if process spawned correctly
  if (!spawnedProcess.pid) {
    // Attempt to capture any immediate errors if possible
    let errorOutput = "";
    let spawnErr: any | null = null;
    spawnedProcess.stderr?.on(
      "data",
      (data) => (errorOutput += data.toString()),
    );
    await new Promise<void>((resolve) => {
      spawnedProcess.once("error", (err) => {
        spawnErr = err;
        resolve();
      });
    }); // Wait for error event

    const details = [
      spawnErr?.message ? `message=${spawnErr.message}` : null,
      spawnErr?.code ? `code=${spawnErr.code}` : null,
      spawnErr?.errno ? `errno=${spawnErr.errno}` : null,
      spawnErr?.syscall ? `syscall=${spawnErr.syscall}` : null,
      spawnErr?.path ? `path=${spawnErr.path}` : null,
      spawnErr?.spawnargs
        ? `spawnargs=${JSON.stringify(spawnErr.spawnargs)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error(
      `Failed to spawn process for app ${appId}. Command="${command}", CWD="${appPath}", ${details}\nSTDERR:\n${
        errorOutput || "(empty)"
      }`,
    );

    throw new Error(
      `Failed to spawn process for app ${appId}.
Error output:
${errorOutput || "(empty)"}
Details: ${details || "n/a"}
`,
    );
  }

  // Increment the counter and store the process reference with its ID
  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process: spawnedProcess,
    processId: currentProcessId,
    isDocker: false,
  });

  listenToProcess({
    process: spawnedProcess,
    appId,
    isNeon,
    event,
  });
}

function listenToProcess({
  process: spawnedProcess,
  appId,
  isNeon,
  event,
}: {
  process: ChildProcess;
  appId: number;
  isNeon: boolean;
  event: Electron.IpcMainInvokeEvent;
}) {
  // Log output
  spawnedProcess.stdout?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.debug(
      `App ${appId} (PID: ${spawnedProcess.pid}) stdout: ${message}`,
    );

    // Add to central log store
    addLog({
      level: "info",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    // This is a hacky heuristic to pick up when drizzle is asking for user
    // to select from one of a few choices. We automatically pick the first
    // option because it's usually a good default choice. We guard this with
    // isNeon because: 1) only Neon apps (for the official Dyad templates) should
    // get this template and 2) it's safer to do this with Neon apps because
    // their databases have point in time restore built-in.
    if (isNeon && message.includes("created or renamed from another")) {
      spawnedProcess.stdin?.write(`\r\n`);
      logger.info(
        `App ${appId} (PID: ${spawnedProcess.pid}) wrote enter to stdin to automatically respond to drizzle push input`,
      );
    }

    // Check if this is an interactive prompt requiring user input
    const inputRequestPattern = /\s*›\s*\([yY]\/[nN]\)\s*$/;
    const isInputRequest = inputRequestPattern.test(message);
    if (isInputRequest) {
      // Send special input-requested event for interactive prompts
      safeSend(event.sender, "app:output", {
        type: "input-requested",
        message,
        appId,
      });
    } else {
      // Normal stdout handling
      safeSend(event.sender, "app:output", {
        type: "stdout",
        message,
        appId,
      });

      const urlMatch = message.match(/(https?:\/\/localhost:\d+\/?)/);
      if (urlMatch) {
        proxyWorker = await startProxy(urlMatch[1], {
          onStarted: (proxyUrl) => {
            safeSend(event.sender, "app:output", {
              type: "stdout",
              message: `[dyad-proxy-server]started=[${proxyUrl}] original=[${urlMatch[1]}]`,
              appId,
            });
          },
        });
      }
    }
  });

  spawnedProcess.stderr?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.error(
      `App ${appId} (PID: ${spawnedProcess.pid}) stderr: ${message}`,
    );

    // Add to central log store
    addLog({
      level: "error",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    safeSend(event.sender, "app:output", {
      type: "stderr",
      message,
      appId,
    });
  });

  // Handle process exit/close
  spawnedProcess.on("close", (code, signal) => {
    logger.log(
      `App ${appId} (PID: ${spawnedProcess.pid}) process closed with code ${code}, signal ${signal}.`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
  });

  // Handle errors during process lifecycle (e.g., command not found)
  spawnedProcess.on("error", (err) => {
    logger.error(
      `Error in app ${appId} (PID: ${spawnedProcess.pid}) process: ${err.message}`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
    // Note: We don't throw here as the error is asynchronous. The caller got a success response already.
    // Consider adding ipcRenderer event emission to notify UI of the error.
  });
}

async function executeAppInDocker({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  const containerName = `dyad-app-${appId}`;

  // First, check if Docker is available
  try {
    await new Promise<void>((resolve, reject) => {
      const checkDocker = spawn("docker", ["--version"], { stdio: "pipe" });
      checkDocker.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Docker is not available"));
        }
      });
      checkDocker.on("error", () => {
        reject(new Error("Docker is not available"));
      });
    });
  } catch {
    throw new Error(
      "Docker is required but not available. Please install Docker Desktop and ensure it's running.",
    );
  }

  // Stop and remove any existing container with the same name
  try {
    await new Promise<void>((resolve) => {
      const stopContainer = spawn("docker", ["stop", containerName], {
        stdio: "pipe",
      });
      stopContainer.on("close", () => {
        const removeContainer = spawn("docker", ["rm", containerName], {
          stdio: "pipe",
        });
        removeContainer.on("close", () => resolve());
        removeContainer.on("error", () => resolve()); // Container might not exist
      });
      stopContainer.on("error", () => resolve()); // Container might not exist
    });
  } catch (error) {
    logger.info(
      `Docker container ${containerName} not found. Ignoring error: ${error}`,
    );
  }

  // Create a Dockerfile in the app directory if it doesn't exist
  const dockerfilePath = path.join(appPath, "Dockerfile.dyad");
  if (!fs.existsSync(dockerfilePath)) {
    const dockerfileContent = `FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm
`;

    try {
      await fsPromises.writeFile(dockerfilePath, dockerfileContent, "utf-8");
    } catch (error) {
      logger.error(`Failed to create Dockerfile for app ${appId}:`, error);
      throw new Error(`Failed to create Dockerfile: ${error}`);
    }
  }

  // Build the Docker image
  const buildProcess = spawn(
    "docker",
    ["build", "-f", "Dockerfile.dyad", "-t", `dyad-app-${appId}`, "."],
    {
      cwd: appPath,
      stdio: "pipe",
    },
  );

  let buildError = "";
  buildProcess.stderr?.on("data", (data) => {
    buildError += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    buildProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed: ${buildError}`));
      }
    });
    buildProcess.on("error", (err) => {
      reject(new Error(`Docker build process error: ${err.message}`));
    });
  });

  // Run the Docker container
  const port = getAppPort(appId);
  const process = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "-p",
      `${port}:${port}`,
      "-v",
      `${appPath}:/app`,
      "-v",
      `dyad-pnpm-${appId}:/app/.pnpm-store`,
      "-e",
      "PNPM_STORE_PATH=/app/.pnpm-store",
      "-w",
      "/app",
      `dyad-app-${appId}`,
      "sh",
      "-c",
      getCommand({ appId, installCommand, startCommand }),
    ],
    {
      stdio: "pipe",
      detached: false,
    },
  );

  // Check if process spawned correctly
  if (!process.pid) {
    // Attempt to capture any immediate errors if possible
    let errorOutput = "";
    let spawnErr: any = null;
    process.stderr?.on("data", (data) => (errorOutput += data.toString()));
    await new Promise<void>((resolve) => {
      process.once("error", (err) => {
        spawnErr = err;
        resolve();
      });
    }); // Wait for error event

    const details = [
      spawnErr?.message ? `message=${spawnErr.message}` : null,
      spawnErr?.code ? `code=${spawnErr.code}` : null,
      spawnErr?.errno ? `errno=${spawnErr.errno}` : null,
      spawnErr?.syscall ? `syscall=${spawnErr.syscall}` : null,
      spawnErr?.path ? `path=${spawnErr.path}` : null,
      spawnErr?.spawnargs
        ? `spawnargs=${JSON.stringify(spawnErr.spawnargs)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error(
      `Failed to spawn Docker container for app ${appId}. ${details}\nSTDERR:\n${
        errorOutput || "(empty)"
      }`,
    );

    throw new Error(
      `Failed to spawn Docker container for app ${appId}.
Details: ${details || "n/a"}
STDERR:
${errorOutput || "(empty)"}`,
    );
  }

  // Increment the counter and store the process reference with its ID
  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process,
    processId: currentProcessId,
    isDocker: true,
    containerName,
  });

  listenToProcess({
    process,
    appId,
    isNeon,
    event,
  });
}

// Helper to kill process on a specific port (cross-platform, using kill-port)
async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPort(port, "tcp");
  } catch {
    // Ignore if nothing was running on that port
  }
}

// Helper to stop any Docker containers publishing a given host port
async function stopDockerContainersOnPort(port: number): Promise<void> {
  try {
    // List container IDs that publish the given port
    const list = spawn("docker", ["ps", "--filter", `publish=${port}`, "-q"], {
      stdio: "pipe",
    });

    let stdout = "";
    list.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    await new Promise<void>((resolve) => {
      list.on("close", () => resolve());
      list.on("error", () => resolve());
    });

    const containerIds = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (containerIds.length === 0) {
      return;
    }

    // Stop each container best-effort
    await Promise.all(
      containerIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const stop = spawn("docker", ["stop", id], { stdio: "pipe" });
            stop.on("close", () => resolve());
            stop.on("error", () => resolve());
          }),
      ),
    );
  } catch (e) {
    logger.warn(`Failed stopping Docker containers on port ${port}: ${e}`);
  }
}

async function searchAppFilesWithRipgrep({
  appPath,
  query,
}: {
  appPath: string;
  query: string;
}): Promise<AppFileSearchResult[]> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, AppFileSearchResult>();
    const args = [
      "--json",
      "--no-config",
      "--ignore-case",
      "--fixed-strings",
      "--max-filesize",
      `${MAX_FILE_SEARCH_SIZE}`,
      ...RIPGREP_EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
      query,
      ".",
    ];

    const rg = spawn(getRgExecutablePath(), args, { cwd: appPath });
    let buffer = "";

    rg.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type !== "match" || !event.data) {
            continue;
          }

          const matchPath = event.data.path?.text as string;
          if (!matchPath) continue;

          const absolutePath = path.isAbsolute(matchPath)
            ? matchPath
            : path.join(appPath, matchPath);
          const relativePath = normalizePath(
            path.relative(appPath, absolutePath),
          );
          if (relativePath.startsWith("..")) {
            continue; // outside app directory
          }

          const lineText = event.data.lines?.text as string;
          const lineNumber = event.data.line_number as number;
          const submatch = event.data.submatches?.[0];
          if (
            typeof lineText !== "string" ||
            typeof lineNumber !== "number" ||
            !submatch
          ) {
            continue;
          }

          const snippet = buildSnippetFromMatch({
            lineText,
            start: submatch.start,
            end: submatch.end,
            lineNumber,
          });

          const existing = results.get(relativePath);
          if (!existing) {
            results.set(relativePath, {
              path: relativePath,
              matchesContent: true,
              snippets: [snippet],
            });
          } else {
            // Add snippet to existing result if it doesn't already exist (avoid duplicates)
            if (!existing.snippets) {
              existing.snippets = [];
            }
            // Only add if this line number isn't already in the snippets
            const existingLine = existing.snippets.find(
              (s) => s.line === snippet.line,
            );
            if (!existingLine) {
              existing.snippets.push(snippet);
            }
          }
        } catch (error) {
          logger.warn("Failed to parse ripgrep output line:", line, error);
        }
      }
    });

    rg.stderr.on("data", (data) => {
      const message = data.toString();
      if (message.toLowerCase().includes("binary file skipped")) {
        return;
      }
      logger.debug("ripgrep stderr:", message);
    });

    rg.on("close", (code) => {
      // rg exits with code 1 when no matches are found; treat as success
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep exited with code ${code}`));
        return;
      }
      resolve(Array.from(results.values()));
    });

    rg.on("error", (error) => {
      reject(error);
    });
  });
}

export function registerAppHandlers() {
  createTypedHandler(systemContracts.restartDyad, async () => {
    app.relaunch();
    app.quit();
  });

  createTypedHandler(appContracts.createApp, async (_, params) => {
    const appPath = params.name;
    const fullAppPath = getDyadAppPath(appPath);
    if (fs.existsSync(fullAppPath)) {
      throw new Error(`App already exists at: ${fullAppPath}`);
    }
    // Create a new app
    const [app] = await db
      .insert(apps)
      .values({
        name: params.name,
        // Use the name as the path for now
        path: appPath,
      })
      .returning();

    // Create an initial chat for this app
    const [chat] = await db
      .insert(chats)
      .values({
        appId: app.id,
      })
      .returning();

    await createFromTemplate({
      fullAppPath,
    });

    // Initialize git repo and create first commit

    await gitInit({ path: fullAppPath, ref: "main" });

    // Stage all files
    await gitAdd({ path: fullAppPath, filepath: "." });

    // Create initial commit
    const commitHash = await gitCommit({
      path: fullAppPath,
      message: "Init Dyad app",
    });

    // Update chat with initial commit hash
    await db
      .update(chats)
      .set({
        initialCommitHash: commitHash,
      })
      .where(eq(chats.id, chat.id));

    return {
      app: { ...app, resolvedPath: fullAppPath },
      chatId: chat.id,
    };
  });

  createTypedHandler(appContracts.copyApp, async (_, params) => {
    const { appId, newAppName, withHistory } = params;

    // 1. Check if an app with the new name already exists
    const existingApp = await db.query.apps.findFirst({
      where: eq(apps.name, newAppName),
    });

    if (existingApp) {
      throw new Error(`An app named "${newAppName}" already exists.`);
    }

    // 2. Find the original app
    const originalApp = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!originalApp) {
      throw new Error("Original app not found.");
    }

    const originalAppPath = getDyadAppPath(originalApp.path);
    const newAppPath = getDyadAppPath(newAppName);

    // 3. Copy the app folder
    try {
      await copyDir(
        originalAppPath,
        newAppPath,
        (source: string) => {
          if (!withHistory && path.basename(source) === ".git") {
            return false;
          }
          return true;
        },
        { excludeNodeModules: true },
      );
    } catch (error) {
      logger.error("Failed to copy app directory:", error);
      throw new Error("Failed to copy app directory.");
    }

    if (!withHistory) {
      // Initialize git repo and create first commit
      await gitInit({ path: newAppPath, ref: "main" });

      // Stage all files
      await gitAdd({ path: newAppPath, filepath: "." });

      // Create initial commit
      await gitCommit({
        path: newAppPath,
        message: "Init Dyad app",
      });
    }

    // 4. Create a new app entry in the database
    const [newDbApp] = await db
      .insert(apps)
      .values({
        name: newAppName,
        path: newAppName, // Use the new name for the path
        // Explicitly set these to null because we don't want to copy them over.
        // Note: we could just leave them out since they're nullable field, but this
        // is to make it explicit we intentionally don't want to copy them over.
        supabaseProjectId: null,
        githubOrg: null,
        githubRepo: null,
        installCommand: originalApp.installCommand,
        startCommand: originalApp.startCommand,
      })
      .returning();

    return { app: newDbApp };
  });

  createTypedHandler(appContracts.getApp, async (_, appId) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    // Get app files
    const appPath = getDyadAppPath(app.path);
    let files: string[] = [];

    try {
      files = getFilesRecursively(appPath, appPath);
      // Normalize the path to use forward slashes so file tree (UI)
      // can parse it more consistently across platforms.
      files = files.map((path) => normalizePath(path));
    } catch (error) {
      logger.error(`Error reading files for app ${appId}:`, error);
      // Return app even if files couldn't be read
    }

    let supabaseProjectName: string | null = null;
    const settings = readSettings();
    // Check for multi-organization credentials or legacy single account
    const hasSupabaseCredentials =
      (app.supabaseOrganizationSlug &&
        settings.supabase?.organizations?.[app.supabaseOrganizationSlug]
          ?.accessToken?.value) ||
      settings.supabase?.accessToken?.value;
    if (app.supabaseProjectId && hasSupabaseCredentials) {
      supabaseProjectName = await getSupabaseProjectName(
        app.supabaseParentProjectId || app.supabaseProjectId,
        app.supabaseOrganizationSlug ?? undefined,
      );
    }

    let vercelTeamSlug: string | null = null;
    if (app.vercelTeamId) {
      vercelTeamSlug = await getVercelTeamSlug(app.vercelTeamId);
    }

    return {
      ...app,
      files,
      resolvedPath: appPath,
      supabaseProjectName,
      vercelTeamSlug,
    };
  });

  createTypedHandler(appContracts.listApps, async () => {
    const allApps = await db.query.apps.findMany({
      orderBy: [desc(apps.createdAt)],
    });
    const appsWithResolvedPath = allApps.map((app) => ({
      ...app,
      resolvedPath: getDyadAppPath(app.path),
    }));
    return {
      apps: appsWithResolvedPath,
    };
  });

  createTypedHandler(appContracts.readAppFile, async (_, params) => {
    const { appId, filePath } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);
    const fullPath = path.join(appPath, filePath);

    // Check if the path is within the app directory (security check)
    if (!fullPath.startsWith(appPath)) {
      throw new Error("Invalid file path");
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error("File not found");
    }

    try {
      const contents = fs.readFileSync(fullPath, "utf-8");
      return contents;
    } catch (error) {
      logger.error(`Error reading file ${filePath} for app ${appId}:`, error);
      throw new Error("Failed to read file");
    }
  });

  // Do NOT use typed handler for this, it contains sensitive information.
  ipcMain.handle("get-env-vars", async () => {
    const envVars: Record<string, string | undefined> = {};
    const providers = await getLanguageModelProviders();
    for (const provider of providers) {
      if (provider.envVarName) {
        envVars[provider.envVarName] = getEnvVar(provider.envVarName);
      }
    }
    return envVars;
  });

  createTypedHandler(appContracts.runApp, async (event, params) => {
    const { appId } = params;
    return withLock(appId, async () => {
      // Check if app is already running
      if (runningApps.has(appId)) {
        logger.debug(`App ${appId} is already running.`);
        return;
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      logger.debug(`Starting app ${appId} in path ${app.path}`);

      const appPath = getDyadAppPath(app.path);
      try {
        // There may have been a previous run that left a process on this port.
        await cleanUpPort(getAppPort(appId));
        await executeApp({
          appPath,
          appId,
          event,
          isNeon: !!app.neonProjectId,
          installCommand: app.installCommand,
          startCommand: app.startCommand,
        });

        return;
      } catch (error: any) {
        logger.error(`Error running app ${appId}:`, error);
        // Ensure cleanup if error happens during setup but before process events are handled
        if (
          runningApps.has(appId) &&
          runningApps.get(appId)?.processId === processCounter.value
        ) {
          runningApps.delete(appId);
        }
        throw new Error(`Failed to run app ${appId}: ${error.message}`);
      }
    });
  });

  createTypedHandler(appContracts.stopApp, async (_, params) => {
    const { appId } = params;
    logger.log(
      `Attempting to stop app ${appId}. Current running apps: ${runningApps.size}`,
    );
    return withLock(appId, async () => {
      const appInfo = runningApps.get(appId);

      if (!appInfo) {
        logger.log(
          `App ${appId} not found in running apps map. Assuming already stopped.`,
        );
        return;
      }

      const { process, processId } = appInfo;
      logger.log(
        `Found running app ${appId} with processId ${processId} (PID: ${process.pid}). Attempting to stop.`,
      );

      // Check if the process is already exited or closed
      if (process.exitCode !== null || process.signalCode !== null) {
        logger.log(
          `Process for app ${appId} (PID: ${process.pid}) already exited (code: ${process.exitCode}, signal: ${process.signalCode}). Cleaning up map.`,
        );
        runningApps.delete(appId); // Ensure cleanup if somehow missed
        return;
      }

      try {
        await stopAppByInfo(appId, appInfo);

        // Now, safely remove the app from the map *after* confirming closure
        removeAppIfCurrentProcess(appId, process);

        return;
      } catch (error: any) {
        logger.error(
          `Error stopping app ${appId} (PID: ${process.pid}, processId: ${processId}):`,
          error,
        );
        // Attempt cleanup even if an error occurred during the stop process
        removeAppIfCurrentProcess(appId, process);
        throw new Error(`Failed to stop app ${appId}: ${error.message}`);
      }
    });
  });

  createTypedHandler(appContracts.restartApp, async (event, params) => {
    const { appId, removeNodeModules } = params;
    logger.log(`Restarting app ${appId}`);
    return withLock(appId, async () => {
      try {
        // First stop the app if it's running
        const appInfo = runningApps.get(appId);
        if (appInfo) {
          const { processId } = appInfo;
          logger.log(
            `Stopping app ${appId} (processId ${processId}) before restart`,
          );
          await stopAppByInfo(appId, appInfo);
        } else {
          logger.log(`App ${appId} not running. Proceeding to start.`);
        }

        // There may have been a previous run that left a process on this port.
        await cleanUpPort(getAppPort(appId));

        // Now start the app again
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);

        // Remove node_modules if requested
        if (removeNodeModules) {
          const settings = readSettings();
          const runtimeMode = settings.runtimeMode2 ?? "host";

          const nodeModulesPath = path.join(appPath, "node_modules");
          logger.log(
            `Removing node_modules for app ${appId} at ${nodeModulesPath}`,
          );
          if (fs.existsSync(nodeModulesPath)) {
            await fsPromises.rm(nodeModulesPath, {
              recursive: true,
              force: true,
            });
            logger.log(`Successfully removed node_modules for app ${appId}`);
          } else {
            logger.log(`No node_modules directory found for app ${appId}`);
          }

          // If running in Docker mode, also remove container volumes so deps reinstall freshly
          if (runtimeMode === "docker") {
            logger.log(
              `Docker mode detected for app ${appId}. Removing Docker volumes dyad-pnpm-${appId}...`,
            );
            try {
              await removeDockerVolumesForApp(appId);
              logger.log(
                `Removed Docker volumes for app ${appId} (dyad-pnpm-${appId}).`,
              );
            } catch (e) {
              // Best-effort cleanup; log and continue
              logger.warn(
                `Failed to remove Docker volumes for app ${appId}. Continuing: ${e}`,
              );
            }
          }
        }

        logger.debug(
          `Executing app ${appId} in path ${app.path} after restart request`,
        ); // Adjusted log

        await executeApp({
          appPath,
          appId,
          event,
          isNeon: !!app.neonProjectId,
          installCommand: app.installCommand,
          startCommand: app.startCommand,
        }); // This will handle starting either mode

        return;
      } catch (error) {
        logger.error(`Error restarting app ${appId}:`, error);
        throw error;
      }
    });
  });

  createTypedHandler(appContracts.editAppFile, async (_, params) => {
    let { appId, filePath, content } = params;
    // It should already be normalized, but just in case.
    filePath = normalizePath(filePath);
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);
    const fullPath = path.join(appPath, filePath);

    // Check if the path is within the app directory (security check)
    if (!fullPath.startsWith(appPath)) {
      throw new Error("Invalid file path");
    }

    if (app.neonProjectId && app.neonDevelopmentBranchId) {
      try {
        await storeDbTimestampAtCurrentVersion({
          appId: app.id,
        });
      } catch (error) {
        logger.error("Error storing Neon timestamp at current version:", error);
        throw new Error(
          "Could not store Neon timestamp at current version; database versioning functionality is not working: " +
            error,
        );
      }
    }

    // Ensure directory exists
    const dirPath = path.dirname(fullPath);
    await fsPromises.mkdir(dirPath, { recursive: true });

    try {
      await fsPromises.writeFile(fullPath, content, "utf-8");

      // Check if git repository exists and commit the change
      if (fs.existsSync(path.join(appPath, ".git"))) {
        await gitAdd({ path: appPath, filepath: filePath });

        await gitCommit({
          path: appPath,
          message: `Updated ${filePath}`,
        });
      }
    } catch (error: any) {
      logger.error(`Error writing file ${filePath} for app ${appId}:`, error);
      throw new Error(`Failed to write file: ${error.message}`);
    }

    if (app.supabaseProjectId) {
      // Check if shared module was modified - redeploy all functions
      if (isSharedServerModule(filePath)) {
        try {
          logger.info(
            `Shared module ${filePath} modified, redeploying all Supabase functions`,
          );
          const settings = readSettings();
          const deployErrors = await deployAllSupabaseFunctions({
            appPath,
            supabaseProjectId: app.supabaseProjectId,
            supabaseOrganizationSlug: app.supabaseOrganizationSlug ?? null,
            skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
          });
          if (deployErrors.length > 0) {
            return {
              warning: `File saved, but some Supabase functions failed to deploy: ${deployErrors.join(", ")}`,
            };
          }
        } catch (error) {
          logger.error(
            `Error redeploying Supabase functions after shared module change:`,
            error,
          );
          return {
            warning: `File saved, but failed to redeploy Supabase functions: ${error}`,
          };
        }
      } else if (isServerFunction(filePath)) {
        // Regular function file - deploy just this function
        try {
          const functionName = extractFunctionNameFromPath(filePath);
          await deploySupabaseFunction({
            supabaseProjectId: app.supabaseProjectId,
            functionName,
            appPath,
            organizationSlug: app.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          logger.error(`Error deploying Supabase function ${filePath}:`, error);
          return {
            warning: `File saved, but failed to deploy Supabase function: ${filePath}: ${error}`,
          };
        }
      }
    }
    return {};
  });

  createTypedHandler(appContracts.deleteApp, async (_, params) => {
    const { appId } = params;
    // Static server worker is NOT terminated here anymore

    return withLock(appId, async () => {
      // Check if app exists
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      // Stop the app if it's running
      if (runningApps.has(appId)) {
        const appInfo = runningApps.get(appId)!;
        try {
          logger.log(`Stopping app ${appId} before deletion.`); // Adjusted log
          await stopAppByInfo(appId, appInfo);
        } catch (error: any) {
          logger.error(`Error stopping app ${appId} before deletion:`, error); // Adjusted log
          // Continue with deletion even if stopping fails
        }
      }

      // Clear logs for this app to prevent memory leak
      clearLogs(appId);

      // Delete app from database
      try {
        await db.delete(apps).where(eq(apps.id, appId));
        // Note: Associated chats will cascade delete
      } catch (error: any) {
        logger.error(`Error deleting app ${appId} from database:`, error);
        throw new Error(`Failed to delete app from database: ${error.message}`);
      }

      // Delete app files
      const appPath = getDyadAppPath(app.path);
      try {
        await fsPromises.rm(appPath, { recursive: true, force: true });
      } catch (error: any) {
        logger.error(`Error deleting app files for app ${appId}:`, error);
        throw new Error(
          `App deleted from database, but failed to delete app files. Please delete app files from ${appPath} manually.\n\nError: ${error.message}`,
        );
      }
    });
  });

  createTypedHandler(appContracts.addToFavorite, async (_, params) => {
    const { appId } = params;
    return withLock(appId, async () => {
      try {
        // Fetch the current isFavorite value
        const result = await db
          .select({ isFavorite: apps.isFavorite })
          .from(apps)
          .where(eq(apps.id, appId))
          .limit(1);

        if (result.length === 0) {
          throw new Error(`App with ID ${appId} not found.`);
        }

        const currentIsFavorite = result[0].isFavorite;

        // Toggle the isFavorite value
        const updated = await db
          .update(apps)
          .set({ isFavorite: !currentIsFavorite })
          .where(eq(apps.id, appId))
          .returning({ isFavorite: apps.isFavorite });

        if (updated.length === 0) {
          throw new Error(
            `Failed to update favorite status for app ID ${appId}.`,
          );
        }

        // Return the updated isFavorite value
        return { isFavorite: updated[0].isFavorite };
      } catch (error: any) {
        logger.error(
          `Error in add-to-favorite handler for app ID ${appId}:`,
          error,
        );
        throw new Error(`Failed to toggle favorite status: ${error.message}`);
      }
    });
  });

  createTypedHandler(appContracts.renameApp, async (_, params) => {
    const { appId, appName, appPath: newPath } = params;
    return withLock(appId, async () => {
      let appPath = newPath;
      // Check if app exists
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const pathChanged = appPath !== app.path;

      // Security: reject NEW absolute paths - rename-app should only accept relative paths for new paths
      // Absolute paths should only be set through change-app-location handler
      // If the path is changing and it's absolute, reject it
      if (pathChanged && path.isAbsolute(appPath)) {
        throw new Error(
          "Absolute paths are not allowed when renaming an app folder. Please use a relative folder name only. To change the storage location, use the 'Change location' button.",
        );
      }

      // Validate path for invalid characters when path changes (only for relative paths)
      if (pathChanged) {
        const invalidChars = /[<>:"|?*/\\]/;
        const hasInvalidChars =
          invalidChars.test(appPath) || /[\x00-\x1f]/.test(appPath);

        if (hasInvalidChars) {
          throw new Error(
            `App path "${appPath}" contains characters that are not allowed in folder names: < > : " | ? * / \\ or control characters. Please use a different path.`,
          );
        }
      }

      // Check for conflicts with existing apps
      const nameConflict = await db.query.apps.findFirst({
        where: eq(apps.name, appName),
      });

      if (nameConflict && nameConflict.id !== appId) {
        throw new Error(`An app with the name '${appName}' already exists`);
      }

      // If the current path is absolute, preserve the directory and only change the folder name
      // Otherwise, resolve the new path using the default base path
      const currentResolvedPath = getDyadAppPath(app.path);
      const newAppPath = path.isAbsolute(app.path)
        ? path.join(path.dirname(app.path), appPath)
        : getDyadAppPath(appPath);

      let hasPathConflict = false;
      if (pathChanged) {
        const allApps = await db.query.apps.findMany();
        hasPathConflict = allApps.some((existingApp) => {
          if (existingApp.id === appId) {
            return false;
          }
          return getDyadAppPath(existingApp.path) === newAppPath;
        });
      }

      if (hasPathConflict) {
        throw new Error(`An app with the path '${newAppPath}' already exists`);
      }

      // Stop the app if it's running
      if (runningApps.has(appId)) {
        const appInfo = runningApps.get(appId)!;
        try {
          await stopAppByInfo(appId, appInfo);
        } catch (error: any) {
          logger.error(`Error stopping app ${appId} before renaming:`, error);
          throw new Error(
            `Failed to stop app before renaming: ${error.message}`,
          );
        }
      }

      const oldAppPath = currentResolvedPath;
      // Only move files if needed
      if (newAppPath !== oldAppPath) {
        // Move app files
        try {
          // Check if destination directory already exists
          if (fs.existsSync(newAppPath)) {
            throw new Error(`Destination path '${newAppPath}' already exists`);
          }

          // Create parent directory if it doesn't exist
          await fsPromises.mkdir(path.dirname(newAppPath), {
            recursive: true,
          });

          // Copy the directory without node_modules
          await copyDir(oldAppPath, newAppPath, undefined, {
            excludeNodeModules: true,
          });
        } catch (error: any) {
          logger.error(
            `Error moving app files from ${oldAppPath} to ${newAppPath}:`,
            error,
          );
          // Attempt cleanup if destination exists (partial copy may have occurred)
          if (fs.existsSync(newAppPath)) {
            try {
              await fsPromises.rm(newAppPath, {
                recursive: true,
                force: true,
              });
            } catch (cleanupError) {
              logger.warn(
                `Failed to clean up partial move at ${newAppPath}:`,
                cleanupError,
              );
            }
          }
          throw new Error(`Failed to move app files: ${error.message}`);
        }

        try {
          // Delete the old directory
          await fsPromises.rm(oldAppPath, { recursive: true, force: true });
        } catch (error: any) {
          // Why is this just a warning? This happens quite often on Windows
          // because it has an aggressive file lock.
          //
          // Not deleting the old directory is annoying, but not a big deal
          // since the user can do it themselves if they need to.
          logger.warn(`Error deleting old app directory ${oldAppPath}:`, error);
        }
      }

      // Update app in database
      // If the current path was absolute, store the new absolute path; otherwise store the relative path
      const pathToStore = path.isAbsolute(app.path) ? newAppPath : appPath;
      try {
        await db
          .update(apps)
          .set({
            name: appName,
            path: pathToStore,
          })
          .where(eq(apps.id, appId))
          .returning();

        return;
      } catch (error: any) {
        // Attempt to rollback the file move
        if (newAppPath !== oldAppPath) {
          try {
            // Copy back from new to old
            await copyDir(newAppPath, oldAppPath, undefined, {
              excludeNodeModules: true,
            });
            // Delete the new directory
            await fsPromises.rm(newAppPath, { recursive: true, force: true });
          } catch (rollbackError) {
            logger.error(
              `Failed to rollback file move during rename error:`,
              rollbackError,
            );
          }
        }

        logger.error(`Error updating app ${appId} in database:`, error);
        throw new Error(`Failed to update app in database: ${error.message}`);
      }
    });
  });

  createTypedHandler(systemContracts.resetAll, async () => {
    logger.log("start: resetting all apps and settings.");
    // Stop all running apps first
    logger.log("stopping all running apps...");
    const runningAppIds = Array.from(runningApps.keys());
    for (const appId of runningAppIds) {
      try {
        const appInfo = runningApps.get(appId)!;
        await stopAppByInfo(appId, appInfo);
      } catch (error) {
        logger.error(`Error stopping app ${appId} during reset:`, error);
        // Continue with reset even if stopping fails
      }
    }
    logger.log("all running apps stopped.");
    logger.log("deleting database...");
    // 1. Drop the database by deleting the SQLite file
    const dbPath = getDatabasePath();
    if (fs.existsSync(dbPath)) {
      // Close database connections first
      if (db.$client) {
        db.$client.close();
      }
      await fsPromises.unlink(dbPath);
      logger.log(`Database file deleted: ${dbPath}`);
    }
    logger.log("database deleted.");
    logger.log("deleting settings...");
    // 2. Remove settings
    const userDataPath = getUserDataPath();
    const settingsPath = path.join(userDataPath, "user-settings.json");

    if (fs.existsSync(settingsPath)) {
      await fsPromises.unlink(settingsPath);
      logger.log(`Settings file deleted: ${settingsPath}`);
    }
    logger.log("settings deleted.");
    // 3. Remove all app files recursively
    // Doing this last because it's the most time-consuming and the least important
    // in terms of resetting the app state.
    logger.log("removing all app files...");
    const dyadAppPath = getDyadAppPath(".");
    if (fs.existsSync(dyadAppPath)) {
      await fsPromises.rm(dyadAppPath, { recursive: true, force: true });
      // Recreate the base directory
      await fsPromises.mkdir(dyadAppPath, { recursive: true });
    }
    logger.log("all app files removed.");
    logger.log("reset all complete.");
  });

  createTypedHandler(systemContracts.getAppVersion, async () => {
    // Read version from package.json at project root
    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return { version: packageJson.version };
  });

  createTypedHandler(appContracts.renameBranch, async (_, params) => {
    const { appId, oldBranchName, newBranchName } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);

    return withLock(appId, async () => {
      try {
        // Check if the old branch exists
        const branches = await gitListBranches({ path: appPath });
        if (!branches.includes(oldBranchName)) {
          throw new Error(`Branch '${oldBranchName}' not found.`);
        }

        // Check if the new branch name already exists
        if (branches.includes(newBranchName)) {
          // If newBranchName is 'main' and oldBranchName is 'master',
          // and 'main' already exists, we might want to allow this if 'main' is the current branch
          // and just switch to it, or delete 'master'.
          // For now, let's keep it simple and throw an error.
          throw new Error(
            `Branch '${newBranchName}' already exists. Cannot rename.`,
          );
        }

        await gitRenameBranch({
          path: appPath,
          oldBranch: oldBranchName,
          newBranch: newBranchName,
        });
        logger.info(
          `Branch renamed from '${oldBranchName}' to '${newBranchName}' for app ${appId}`,
        );
      } catch (error: any) {
        logger.error(
          `Failed to rename branch for app ${appId}: ${error.message}`,
        );
        throw new Error(
          `Failed to rename branch '${oldBranchName}' to '${newBranchName}': ${error.message}`,
        );
      }
    });
  });

  createTypedHandler(appContracts.respondToAppInput, async (_, params) => {
    const { appId, response } = params;
    if (response !== "y" && response !== "n") {
      throw new Error(`Invalid response: ${response}`);
    }
    const appInfo = runningApps.get(appId);

    if (!appInfo) {
      throw new Error(`App ${appId} is not running`);
    }

    const { process } = appInfo;

    if (!process.stdin) {
      throw new Error(`App ${appId} process has no stdin available`);
    }

    try {
      // Write the response to stdin with a newline
      process.stdin.write(`${response}\n`);
      logger.debug(`Sent response '${response}' to app ${appId} stdin`);
    } catch (error: any) {
      logger.error(`Error sending response to app ${appId}:`, error);
      throw new Error(`Failed to send response to app: ${error.message}`);
    }
  });

  createTypedHandler(appContracts.searchAppFiles, async (_, params) => {
    const { appId, query } = params;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const appRecord = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!appRecord) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(appRecord.path);

    // Search file contents with ripgrep
    const contentMatches = await searchAppFilesWithRipgrep({
      appPath,
      query: trimmedQuery,
    });

    return contentMatches;
  });

  // search-app is not in app contracts - keep using handle
  handle(
    "search-app",
    async (_, searchQuery: string): Promise<AppSearchResult[]> => {
      // Use parameterized query to prevent SQL injection
      const pattern = `%${searchQuery.replace(/[%_]/g, "\\$&")}%`;

      // 1) Apps whose name matches
      const appNameMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
        })
        .from(apps)
        .where(like(apps.name, pattern))
        .orderBy(desc(apps.createdAt));

      const appNameMatchesResult: AppSearchResult[] = appNameMatches.map(
        (r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          matchedChatTitle: null,
          matchedChatMessage: null,
        }),
      );

      // 2) Apps whose chat title matches
      const chatTitleMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
          matchedChatTitle: chats.title,
        })
        .from(apps)
        .innerJoin(chats, eq(apps.id, chats.appId))
        .where(like(chats.title, pattern))
        .orderBy(desc(apps.createdAt));

      const chatTitleMatchesResult: AppSearchResult[] = chatTitleMatches.map(
        (r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          matchedChatTitle: r.matchedChatTitle,
          matchedChatMessage: null,
        }),
      );

      // 3) Apps whose chat message content matches
      const chatMessageMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
          matchedChatTitle: chats.title,
          matchedChatMessage: messages.content,
        })
        .from(apps)
        .innerJoin(chats, eq(apps.id, chats.appId))
        .innerJoin(messages, eq(chats.id, messages.chatId))
        .where(like(messages.content, pattern))
        .orderBy(desc(apps.createdAt));

      // Flatten and dedupe by app id
      const allMatches: AppSearchResult[] = [
        ...appNameMatchesResult,
        ...chatTitleMatchesResult,
        ...chatMessageMatches,
      ];
      const uniqueApps = Array.from(
        new Map(allMatches.map((app) => [app.id, app])).values(),
      );

      // Sort newest apps first
      uniqueApps.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return uniqueApps;
    },
  );

  // Handler for adding logs to central store from renderer
  createTypedHandler(miscContracts.addLog, async (_, entry) => {
    addLog(entry);
  });

  // Handler for clearing logs for a specific app
  createTypedHandler(miscContracts.clearLogs, async (_, { appId }) => {
    clearLogs(appId);
  });

  // select-app-location is not in app contracts - keep using handle
  handle(
    "select-app-location",
    async (
      _,
      { defaultPath }: { defaultPath?: string },
    ): Promise<{ path: string | null; canceled: boolean }> => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Select a folder where this app will be stored",
        defaultPath,
      });

      if (result.canceled || !result.filePaths[0]) {
        return { path: null, canceled: true };
      }

      return { path: result.filePaths[0], canceled: false };
    },
  );

  createTypedHandler(appContracts.updateAppCommands, async (_, params) => {
    const { appId, installCommand, startCommand } = params;

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const trimmedInstall = installCommand?.trim() || null;
    const trimmedStart = startCommand?.trim() || null;

    // Both commands must be provided together, or both must be null
    if ((trimmedInstall === null) !== (trimmedStart === null)) {
      throw new Error(
        "Both install and start commands are required when customizing",
      );
    }

    await db
      .update(apps)
      .set({
        installCommand: trimmedInstall,
        startCommand: trimmedStart,
      })
      .where(eq(apps.id, appId));

    logger.info(`Updated commands for app ${appId}`);
  });

  createTypedHandler(appContracts.changeAppLocation, async (_, params) => {
    const { appId, parentDirectory } = params;

    if (!parentDirectory) {
      throw new Error("No destination folder provided.");
    }

    if (!path.isAbsolute(parentDirectory)) {
      throw new Error("Please select an absolute destination folder.");
    }

    const normalizedParentDir = path.normalize(parentDirectory);

    return withLock(appId, async () => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const currentResolvedPath = getDyadAppPath(app.path);
      // Extract app folder name from current path (works for both absolute and relative paths)
      const appFolderName = path.basename(
        path.isAbsolute(app.path) ? app.path : currentResolvedPath,
      );
      const nextResolvedPath = path.join(normalizedParentDir, appFolderName);

      if (currentResolvedPath === nextResolvedPath) {
        // Path hasn't changed, but we should update to absolute path format if needed
        if (!path.isAbsolute(app.path)) {
          await db
            .update(apps)
            .set({ path: nextResolvedPath })
            .where(eq(apps.id, appId));
        }
        return {
          resolvedPath: nextResolvedPath,
        };
      }

      const allApps = await db.query.apps.findMany();
      const conflict = allApps.some(
        (existingApp) =>
          existingApp.id !== appId &&
          getDyadAppPath(existingApp.path) === nextResolvedPath,
      );

      if (conflict) {
        throw new Error(
          `Another app already exists at '${nextResolvedPath}'. Please choose a different folder.`,
        );
      }

      if (fs.existsSync(nextResolvedPath)) {
        throw new Error(
          `Destination path '${nextResolvedPath}' already exists. Please choose an empty folder.`,
        );
      }

      // Check if source path exists - if not, just update the DB path without copying
      const sourceExists = fs.existsSync(currentResolvedPath);
      if (!sourceExists) {
        logger.warn(
          `Source path ${currentResolvedPath} does not exist. Updating database path only.`,
        );
        await db
          .update(apps)
          .set({ path: nextResolvedPath })
          .where(eq(apps.id, appId));
        return {
          resolvedPath: nextResolvedPath,
        };
      }

      if (runningApps.has(appId)) {
        const appInfo = runningApps.get(appId)!;
        try {
          await stopAppByInfo(appId, appInfo);
        } catch (error: any) {
          logger.error(`Error stopping app ${appId} before moving:`, error);
          throw new Error(`Failed to stop app before moving: ${error.message}`);
        }
      }

      await fsPromises.mkdir(normalizedParentDir, { recursive: true });

      try {
        // Copy the directory without node_modules
        await copyDir(currentResolvedPath, nextResolvedPath, undefined, {
          excludeNodeModules: true,
        });

        // Update path to absolute path
        await db
          .update(apps)
          .set({ path: nextResolvedPath })
          .where(eq(apps.id, appId));

        try {
          await fsPromises.rm(currentResolvedPath, {
            recursive: true,
            force: true,
          });
        } catch (error: any) {
          logger.warn(
            `Error deleting old app directory ${currentResolvedPath}:`,
            error,
          );
        }

        return {
          resolvedPath: nextResolvedPath,
        };
      } catch (error: any) {
        // Attempt cleanup if destination exists (partial copy may have occurred)
        if (fs.existsSync(nextResolvedPath)) {
          try {
            await fsPromises.rm(nextResolvedPath, {
              recursive: true,
              force: true,
            });
          } catch (cleanupError) {
            logger.warn(
              `Failed to clean up partial move at ${nextResolvedPath}:`,
              cleanupError,
            );
          }
        }
        logger.error(
          `Error moving app files from ${currentResolvedPath} to ${nextResolvedPath}:`,
          error,
        );
        throw new Error(`Failed to move app files: ${error.message}`);
      }
    });
  });
}

function getCommand({
  appId,
  installCommand,
  startCommand,
}: {
  appId: number;
  installCommand?: string | null;
  startCommand?: string | null;
}) {
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  return hasCustomCommands
    ? `${installCommand!.trim()} && ${startCommand!.trim()}`
    : getDefaultCommand(appId);
}

async function cleanUpPort(port: number) {
  const settings = readSettings();
  if (settings.runtimeMode2 === "docker") {
    await stopDockerContainersOnPort(port);
  } else {
    await killProcessOnPort(port);
  }
}
