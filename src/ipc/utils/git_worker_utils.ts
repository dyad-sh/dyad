/**
 * Git Worker Utilities
 *
 * This module provides a wrapper around the git worker thread to allow
 * the main process to run git operations without blocking the event loop.
 */

import { Worker } from "node:worker_threads";
import * as path from "node:path";
import { platform } from "node:os";
import log from "electron-log";
import type {
  GitWorkerInput,
  GitWorkerOutput,
} from "../../../shared/git_worker_types";
import { readSettings } from "../../main/settings";

const logger = log.scope("git_worker_utils");

/**
 * Returns a sanitized environment for git commands on Windows.
 * Filters out WSL-related PATH entries that can cause WSL interop issues.
 * On non-Windows platforms, returns undefined (use default environment).
 */
function getWindowsSanitizedEnv():
  | Record<string, string | undefined>
  | undefined {
  if (platform() !== "win32") {
    return undefined;
  }

  const pathKey =
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const currentPath = process.env[pathKey] ?? "";
  const pathSeparator = ";";

  const sanitizedPathEntries = currentPath
    .split(pathSeparator)
    .filter((entry) => {
      const lowerEntry = entry.toLowerCase();
      if (
        lowerEntry.includes("\\wsl$\\") ||
        lowerEntry.includes("\\wsl.localhost\\") ||
        lowerEntry.includes("windowsapps") ||
        lowerEntry.startsWith("/mnt/") ||
        lowerEntry.startsWith("/usr/") ||
        lowerEntry.startsWith("/bin/") ||
        lowerEntry.startsWith("/home/")
      ) {
        return false;
      }
      return true;
    });

  return {
    ...process.env,
    [pathKey]: sanitizedPathEntries.join(pathSeparator),
  };
}

/**
 * Run a git operation in a worker thread.
 * This prevents blocking the main process event loop during long git operations.
 */
export function runGitOperation(
  input: GitWorkerInput,
): Promise<GitWorkerOutput> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "git_worker.js");

    logger.info(`Starting git worker for operation: ${input.type}`);

    // Pass LOCAL_GIT_DIRECTORY through to the worker's environment
    // so dugite can find the git binary
    const worker = new Worker(workerPath, {
      env: {
        ...process.env,
      },
    });

    worker.on("message", (output: GitWorkerOutput) => {
      worker.terminate();
      if (output.success) {
        logger.info(`Git worker completed successfully: ${input.type}`);
      } else {
        logger.error(`Git worker failed: ${input.type} - ${output.error}`);
      }
      resolve(output);
    });

    worker.on("error", (error) => {
      logger.error(`Git worker error: ${input.type}`, error);
      worker.terminate();
      reject(error);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        logger.error(`Git worker exited with code ${code}`);
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    // Send the input to the worker
    worker.postMessage(input);
  });
}

/**
 * Push to remote using a worker thread.
 */
export async function gitPushWorker({
  appPath,
  branch,
  accessToken,
  force,
  forceWithLease,
}: {
  appPath: string;
  branch: string;
  accessToken?: string;
  force?: boolean;
  forceWithLease?: boolean;
}): Promise<void> {
  const settings = readSettings();
  const result = await runGitOperation({
    type: "push",
    appPath,
    branch,
    accessToken,
    force,
    forceWithLease,
    enableNativeGit: settings.enableNativeGit ?? true,
    sanitizedEnv: getWindowsSanitizedEnv(),
  });

  if (!result.success) {
    const error = new Error(result.error);
    if (result.name) {
      (error as any).name = result.name;
    }
    if (result.code) {
      (error as any).code = result.code;
    }
    throw error;
  }
}

/**
 * Pull from remote using a worker thread.
 */
export async function gitPullWorker({
  appPath,
  branch,
  remote,
  accessToken,
}: {
  appPath: string;
  branch: string;
  remote: string;
  accessToken?: string;
}): Promise<void> {
  const settings = readSettings();
  const result = await runGitOperation({
    type: "pull",
    appPath,
    branch,
    remote,
    accessToken,
    enableNativeGit: settings.enableNativeGit ?? true,
    sanitizedEnv: getWindowsSanitizedEnv(),
  });

  if (!result.success) {
    const error = new Error(result.error);
    if (result.name) {
      (error as any).name = result.name;
    }
    if (result.code) {
      (error as any).code = result.code;
    }
    throw error;
  }
}

/**
 * Set remote URL using a worker thread.
 */
export async function gitSetRemoteUrlWorker({
  appPath,
  remoteUrl,
}: {
  appPath: string;
  remoteUrl: string;
}): Promise<void> {
  const settings = readSettings();
  const result = await runGitOperation({
    type: "setRemoteUrl",
    appPath,
    remoteUrl,
    enableNativeGit: settings.enableNativeGit ?? true,
    sanitizedEnv: getWindowsSanitizedEnv(),
  });

  if (!result.success) {
    throw new Error(result.error);
  }
}
