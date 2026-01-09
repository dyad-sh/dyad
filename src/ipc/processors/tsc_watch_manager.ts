/**
 * TSC Watch Manager
 * Manages background `tsc --watch` processes per app for real-time type checking.
 * Starts when an app is run in local-agent mode with enableAutoFixProblems enabled.
 */

import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WebContents } from "electron";
import log from "electron-log";
import type { ProblemReport, Problem } from "../ipc_types";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("tsc_watch_manager");

interface TscWatchEntry {
  process: ChildProcess;
  appPath: string;
  sender: WebContents;
}

// Store running TSC watch processes per appId
const tscWatchers = new Map<number, TscWatchEntry>();

// Store cached problem reports per appId
const problemCache = new Map<number, ProblemReport>();

/**
 * Find TypeScript config file in the app directory.
 * Same logic as tsc_worker.ts: check tsconfig.app.json first (for Vite apps),
 * then tsconfig.json (for Next.js apps).
 */
function findTypeScriptConfig(appPath: string): string | null {
  const possibleConfigs = [
    // For vite applications, we want to check tsconfig.app.json, since it's the
    // most important one (client-side app).
    "tsconfig.app.json",
    // For Next.js applications, it typically has a single tsconfig.json file
    "tsconfig.json",
  ];

  for (const config of possibleConfigs) {
    const configPath = path.join(appPath, config);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Parse TSC output line to extract problem information.
 * TSC with --pretty false outputs errors like:
 * src/file.tsx(10,5): error TS2322: Message here
 */
function parseTscOutputLine(line: string, appPath: string): Problem | null {
  // Match pattern: file(line,column): error TScode: message
  const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
  if (!match) {
    return null;
  }

  const [, file, lineNum, column, code, message] = match;

  // Normalize the file path to be relative to appPath
  let normalizedFile = file;
  if (path.isAbsolute(file)) {
    normalizedFile = path.relative(appPath, file);
  }
  // Ensure forward slashes
  normalizedFile = normalizedFile.replace(/\\/g, "/");

  return {
    file: normalizedFile,
    line: parseInt(lineNum, 10),
    column: parseInt(column, 10),
    message,
    code: parseInt(code.replace("TS", ""), 10),
    snippet: "", // TSC watch doesn't provide snippets inline
  };
}

/**
 * Check if a line indicates the start of a new compilation.
 * TSC watch outputs messages like:
 * - "Starting compilation in watch mode..."
 * - "File change detected. Starting incremental compilation..."
 */
function isCompilationStartMarker(line: string): boolean {
  return (
    line.includes("Starting compilation") ||
    line.includes("Starting incremental compilation")
  );
}

/**
 * Check if a line indicates compilation is complete.
 * TSC watch outputs messages like:
 * - "Found 0 errors. Watching for file changes."
 * - "Found 5 errors. Watching for file changes."
 */
function isCompilationEndMarker(line: string): boolean {
  return line.includes("Watching for file changes");
}

/**
 * Start a TSC watch process for an app.
 */
export function startTscWatch(
  appId: number,
  appPath: string,
  sender: WebContents,
): void {
  // Stop any existing watcher for this app
  stopTscWatch(appId);

  const configPath = findTypeScriptConfig(appPath);
  if (!configPath) {
    logger.info(
      `No TypeScript config found for app ${appId} at ${appPath}, skipping TSC watch`,
    );
    return;
  }

  logger.info(`Starting TSC watch for app ${appId} with config ${configPath}`);

  // Spawn tsc --watch with --noEmit and --pretty false for parseable output
  const tscProcess = spawn(
    "npx",
    ["tsc", "--watch", "--noEmit", "--pretty", "false", "-p", configPath],
    {
      cwd: appPath,
      shell: true,
      stdio: "pipe",
    },
  );

  if (!tscProcess.pid) {
    logger.error(`Failed to spawn TSC watch process for app ${appId}`);
    return;
  }

  logger.info(
    `TSC watch process started for app ${appId} (PID: ${tscProcess.pid})`,
  );

  // Track problems during a compilation cycle
  let currentProblems: Problem[] = [];
  let isCollecting = false;

  const processOutput = (data: Buffer) => {
    const output = data.toString();
    const lines = output.split(/\r?\n/);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check for compilation start
      if (isCompilationStartMarker(trimmedLine)) {
        isCollecting = true;
        currentProblems = [];
        logger.debug(`TSC watch compilation started for app ${appId}`);
        continue;
      }

      // Check for compilation end
      if (isCompilationEndMarker(trimmedLine)) {
        isCollecting = false;

        // Store and broadcast the problem report
        const problemReport: ProblemReport = { problems: currentProblems };
        problemCache.set(appId, problemReport);

        logger.info(
          `TSC watch compilation complete for app ${appId}: ${currentProblems.length} problems`,
        );

        // Push to UI
        safeSend(sender, "problems:update", {
          appId,
          problemReport,
        });

        currentProblems = [];
        continue;
      }

      // Try to parse as an error line
      if (isCollecting) {
        const problem = parseTscOutputLine(trimmedLine, appPath);
        if (problem) {
          currentProblems.push(problem);
        }
      }
    }
  };

  tscProcess.stdout?.on("data", processOutput);
  tscProcess.stderr?.on("data", processOutput);

  tscProcess.on("error", (error) => {
    logger.error(`TSC watch process error for app ${appId}:`, error);
  });

  tscProcess.on("exit", (code, signal) => {
    logger.info(
      `TSC watch process exited for app ${appId} (code: ${code}, signal: ${signal})`,
    );
    tscWatchers.delete(appId);
  });

  tscWatchers.set(appId, {
    process: tscProcess,
    appPath,
    sender,
  });
}

/**
 * Stop the TSC watch process for an app.
 */
export function stopTscWatch(appId: number): void {
  const entry = tscWatchers.get(appId);
  if (!entry) {
    return;
  }

  logger.info(`Stopping TSC watch for app ${appId}`);

  try {
    // Kill the process and its children (shell: true creates a shell)
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(entry.process.pid), "/f", "/t"], {
        shell: true,
      });
    } else {
      // On Unix, kill the process group
      if (entry.process.pid) {
        process.kill(-entry.process.pid, "SIGTERM");
      }
    }
  } catch (error) {
    logger.warn(`Error killing TSC watch process for app ${appId}:`, error);
    // Try regular kill as fallback
    entry.process.kill("SIGTERM");
  }

  tscWatchers.delete(appId);
  // Keep the cache - it might still be useful
}

/**
 * Get cached problems for an app.
 * Returns null if no cache exists.
 */
export function getCachedProblems(appId: number): ProblemReport | null {
  return problemCache.get(appId) ?? null;
}

/**
 * Clear cached problems for an app.
 */
export function clearCachedProblems(appId: number): void {
  problemCache.delete(appId);
}

/**
 * Check if TSC watch is running for an app.
 */
export function isTscWatchRunning(appId: number): boolean {
  return tscWatchers.has(appId);
}
