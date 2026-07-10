import * as fs from "node:fs";
import * as path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  CodeExplorerHostResponse,
  CodeExplorerResult,
  CodeExplorerWorkerInput,
} from "../../../shared/code_explorer_types";
import log from "electron-log";
import { getTypeScriptCachePath } from "@/paths/paths";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";

const logger = log.scope("code-explorer");
const DEFAULT_CONFIGS = ["tsconfig.app.json", "tsconfig.json"];
const WORKSPACE_CONFIG_DIRS = ["apps", "packages"];
const WORKSPACE_CONFIG_NAMES = ["tsconfig.app.json", "tsconfig.json"];
const MAX_WORKSPACE_CONFIGS_TO_CHECK = 40;
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CRASH_LOOP_WINDOW_MS = 60 * 1000;

export interface CodeExplorerAvailability {
  ready: boolean;
  reason: string | null;
  tsconfigPath: string | null;
}

export function isCodeExplorerReady(appPath: string): boolean {
  return getCodeExplorerAvailability(appPath).ready;
}

// Cheap to recompute (a `require.resolve` + a few `fs` probes, ~3µs on the
// common path), and called only ~3x per turn — so it runs uncached. That also
// means a freshly-installed TypeScript or added tsconfig is reflected
// immediately rather than after a cache TTL.
export function getCodeExplorerAvailability(
  appPath: string,
): CodeExplorerAvailability {
  try {
    require.resolve("typescript", { paths: [appPath] });
  } catch {
    return {
      ready: false,
      reason: "typescript_not_installed",
      tsconfigPath: null,
    };
  }

  const tsconfigPath = discoverTsconfigPath(appPath);
  if (!tsconfigPath) {
    return {
      ready: false,
      reason: "tsconfig_not_found",
      tsconfigPath: null,
    };
  }

  return {
    ready: true,
    reason: null,
    tsconfigPath,
  };
}

export function formatCodeExplorerDisabledReason(
  availability: CodeExplorerAvailability,
): string {
  if (availability.ready) {
    return "available";
  }
  if (availability.reason === "typescript_not_installed") {
    return "TypeScript is not installed in the app";
  }
  if (availability.reason === "tsconfig_not_found") {
    return "No tsconfig.app.json or tsconfig.json was found in the app or nearby workspace package roots";
  }
  return availability.reason ?? "Code explorer is unavailable";
}

function discoverTsconfigPath(appPath: string): string | null {
  for (const config of DEFAULT_CONFIGS) {
    if (fs.existsSync(path.join(appPath, config))) {
      return config;
    }
  }

  for (const candidate of discoverWorkspaceTsconfigs(appPath)) {
    return candidate;
  }

  return null;
}

function discoverWorkspaceTsconfigs(appPath: string): string[] {
  const candidates: string[] = [];
  for (const dirName of WORKSPACE_CONFIG_DIRS) {
    const dir = path.join(appPath, dirName);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

    const children = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();

    for (const child of sortWorkspaceConfigChildren(children)) {
      for (const configName of WORKSPACE_CONFIG_NAMES) {
        const relativePath = path.join(dirName, child, configName);
        if (fs.existsSync(path.join(appPath, relativePath))) {
          candidates.push(relativePath);
          if (candidates.length >= MAX_WORKSPACE_CONFIGS_TO_CHECK) {
            return candidates;
          }
        }
      }
    }
  }

  for (const child of discoverPackageLikeChildren(appPath)) {
    for (const configName of WORKSPACE_CONFIG_NAMES) {
      const relativePath = path.join(child, configName);
      if (fs.existsSync(path.join(appPath, relativePath))) {
        candidates.push(relativePath);
        if (candidates.length >= MAX_WORKSPACE_CONFIGS_TO_CHECK) {
          return candidates;
        }
      }
    }
  }

  return candidates;
}

function discoverPackageLikeChildren(appPath: string): string[] {
  if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
    return [];
  }

  return sortWorkspaceConfigChildren(
    fs
      .readdirSync(appPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => entry.name !== "node_modules")
      .filter((entry) =>
        fs.existsSync(path.join(appPath, entry.name, "package.json")),
      )
      .map((entry) => entry.name),
  );
}

function sortWorkspaceConfigChildren(children: string[]): string[] {
  return [...children].sort((left, right) => {
    const scoreDelta =
      workspaceConfigChildScore(left) - workspaceConfigChildScore(right);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.localeCompare(right);
  });
}

function workspaceConfigChildScore(child: string): number {
  const normalized = child.toLowerCase();
  let score = 0;
  if (/\b(web|dashboard|frontend|front|client|app)\b/.test(normalized)) {
    score -= 10;
  }
  if (
    /\b(docs?|examples?|storybook|playground|e2e|tests?)\b/.test(normalized)
  ) {
    score += 20;
  }
  return score;
}

export function toCodeExplorerError(error: unknown): Error {
  if (error instanceof DyadError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (
    message.startsWith("Failed to load TypeScript from") ||
    message.includes("Cannot find module 'typescript'") ||
    message.startsWith("No TypeScript configuration file found") ||
    message.startsWith("No TypeScript source files found") ||
    message.startsWith("TypeScript config error")
  ) {
    return new DyadError(message, DyadErrorKind.Precondition);
  }

  if (
    message.startsWith("Invalid tsconfig_path") ||
    message.includes("escapes app") ||
    message.includes("escapes project root")
  ) {
    return new DyadError(message, DyadErrorKind.Validation);
  }

  return error instanceof Error ? error : new Error(message);
}

// All explorer sessions share ONE utility process. Electron builds V8 with
// pointer compression, so worker_threads isolates share the main process's
// single ~4GB heap cage and an OOM there aborts the whole app; a utility
// process gets its own cage, its own byte-budgeted index cache (see
// workers/code_explorer/code_explorer_worker.ts), and dies non-fatally.
interface PendingRequest {
  key: string;
  hostGeneration: number;
  resolve: (result: CodeExplorerResult) => void;
  reject: (error: Error) => void;
}

let host: UtilityProcess | null = null;
let hostGeneration = 0;
let nextRequestId = 1;
let idleTimer: NodeJS.Timeout | undefined;
const pendingRequests = new Map<number, PendingRequest>();
// Per-key serial queues preserve the previous per-session semantics: queries
// against the same app+tsconfig never overlap (a rebuild-heavy query would
// just make the second one redo the same work).
const keyQueues = new Map<string, Promise<unknown>>();
// Crash-loop guard: if the host dies twice within CRASH_LOOP_WINDOW_MS while
// serving the same key, that project is likely too large to index — stop
// retrying for the rest of the session instead of respawning forever.
const lastCrashAtByKey = new Map<string, number>();
const unavailableKeys = new Set<string>();

export async function runCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerResult> {
  const workerInput: CodeExplorerWorkerInput = {
    ...input,
    tsBuildInfoCacheDir: getTypeScriptCachePath(),
  };
  const key = explorerKey(workerInput);
  if (unavailableKeys.has(key)) {
    throw keyUnavailableError();
  }

  const prior = keyQueues.get(key) ?? Promise.resolve();
  const run = prior
    .catch(() => undefined)
    .then(() => sendToHost(key, workerInput));
  const tail = run.catch(() => undefined);
  keyQueues.set(key, tail);
  void tail.then(() => {
    if (keyQueues.get(key) === tail) {
      keyQueues.delete(key);
    }
  });
  return run;
}

function explorerKey(input: CodeExplorerWorkerInput): string {
  return `${path.resolve(input.appPath)}\0${input.tsconfigPath ?? ""}`;
}

function keyUnavailableError(): DyadError {
  return new DyadError(
    "Code explorer is unavailable for this project in this session: the indexing process crashed repeatedly while building its index (the project is likely too large to index).",
    DyadErrorKind.Precondition,
  );
}

function sendToHost(
  key: string,
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerResult> {
  return new Promise((resolve, reject) => {
    // Re-check after waiting in the queue: the key may have been marked
    // unavailable by a crash that happened while this request was queued.
    if (unavailableKeys.has(key)) {
      reject(keyUnavailableError());
      return;
    }

    clearIdleTimer();
    const child = getHost();
    const requestId = nextRequestId++;
    pendingRequests.set(requestId, {
      key,
      hostGeneration,
      resolve,
      reject,
    });
    try {
      child.postMessage({ requestId, input });
    } catch (error) {
      pendingRequests.delete(requestId);
      scheduleIdleKillIfIdle();
      reject(toCodeExplorerError(error));
    }
  });
}

function getHost(): UtilityProcess {
  if (host) {
    return host;
  }

  // The worker is emitted next to main.js (`.vite/build`), so this resolves
  // in both dev and packaged (ASAR) builds.
  const workerPath = path.join(__dirname, "code_explorer_worker.js");
  const generation = ++hostGeneration;
  logger.info(`Starting code explorer host (generation ${generation})`);
  // --expose-gc lets the host GC before measuring heap usage for its index
  // byte budget; the explicit old-space ceiling below the 4GB cage would make
  // an overflow fail cleanly (and slightly earlier) instead of at the cage
  // edge. NOTE: Electron 40 delivers execArgv to the child's process.execArgv
  // but does not apply V8 flags from it (verified empirically), so the worker
  // acquires a gc handle at runtime itself and the heap ceiling stays at the
  // cage default; the flags are kept for Electron versions that honor them.
  const child = utilityProcess.fork(workerPath, [], {
    serviceName: "dyad-code-explorer",
    execArgv: ["--expose-gc", "--max-old-space-size=3584"],
  });
  host = child;
  let fatalError: { type: string; location: string } | null = null;

  child.on("message", (response: CodeExplorerHostResponse) => {
    const request = pendingRequests.get(response.requestId);
    if (!request) {
      return;
    }
    pendingRequests.delete(response.requestId);
    scheduleIdleKillIfIdle();
    if (response.success) {
      request.resolve(response.data);
    } else {
      logger.error(`Code explorer host request failed: ${response.error}`);
      request.reject(toCodeExplorerError(new Error(response.error)));
    }
  });

  // Fatal V8 errors in the host (e.g. heap OOM). The exit event still fires
  // afterwards and performs the pending-request cleanup.
  child.on("error", (type, location, report) => {
    fatalError = { type, location };
    logger.error(
      `Code explorer host fatal error: ${type} at ${location}`,
      report,
    );
    child.kill();
  });

  child.on("exit", (code) => {
    if (host === child) {
      host = null;
      clearIdleTimer();
    }
    const failed = [...pendingRequests].filter(
      ([, request]) => request.hostGeneration === generation,
    );
    if (code !== 0 || failed.length > 0) {
      logger.warn(
        `Code explorer host (generation ${generation}) exited with code ${code}; failing ${failed.length} pending request(s)`,
      );
    }
    // The host serves requests strictly FIFO on a single thread, so the
    // oldest pending request (requestIds ascend in Map insertion order) is
    // the one it was processing when it died. Charge the crash to that key
    // only — the others were merely queued behind it, and charging them too
    // would mark unrelated projects unavailable after two crashes caused by
    // one oversized project.
    const activeRequest = failed[0]?.[1];
    const crashLoopedKey =
      activeRequest && recordHostDeathForKey(activeRequest.key)
        ? activeRequest.key
        : null;
    const crashReason = fatalError
      ? "v8_fatal_error"
      : code !== 0
        ? "nonzero_exit"
        : failed.length > 0
          ? "exited_with_pending_requests"
          : null;
    if (crashReason) {
      sendTelemetryEvent("code_explorer:host_crash", {
        error: true,
        generation,
        reason: crashReason,
        exit_code: code,
        pending_request_count: failed.length,
        had_active_request: activeRequest !== undefined,
        crash_loop_guard_triggered: crashLoopedKey !== null,
        ...(fatalError && {
          fatal_error_type: fatalError.type,
          fatal_error_location: fatalError.location,
        }),
      });
    }
    for (const [requestId, request] of failed) {
      pendingRequests.delete(requestId);
      request.reject(
        request.key === crashLoopedKey
          ? keyUnavailableError()
          : toCodeExplorerError(
              new Error(
                `Code explorer host exited with code ${code} before replying`,
              ),
            ),
      );
    }
  });

  return child;
}

/** Returns true when the key just crossed the crash-loop threshold. */
function recordHostDeathForKey(key: string): boolean {
  const now = Date.now();
  const lastCrashAt = lastCrashAtByKey.get(key);
  lastCrashAtByKey.set(key, now);
  if (lastCrashAt !== undefined && now - lastCrashAt < CRASH_LOOP_WINDOW_MS) {
    logger.error(
      `Code explorer host died twice within ${CRASH_LOOP_WINDOW_MS}ms while serving ${key}; marking it unavailable for this session`,
    );
    unavailableKeys.add(key);
    return true;
  }
  return false;
}

function clearIdleTimer(): void {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = undefined;
}

// Idle policy: once no request is in flight, kill the whole host after 5
// minutes, freeing the process baseline AND every cached index. The next
// call lazily respawns it.
function scheduleIdleKillIfIdle(): void {
  if (pendingRequests.size > 0 || !host) {
    return;
  }
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (!host || pendingRequests.size > 0) {
      return;
    }
    logger.info("Killing idle code explorer host");
    const child = host;
    // Detach first so a request racing the kill spawns a fresh host instead
    // of posting to the dying one.
    host = null;
    child.kill();
  }, WORKER_IDLE_TIMEOUT_MS);
}
