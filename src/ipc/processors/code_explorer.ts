import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  CodeExplorerResult,
  CodeExplorerWorkerInput,
  CodeExplorerWorkerOutput,
} from "../../../shared/code_explorer_types";
import log from "electron-log";

const logger = log.scope("code-explorer");
const DEFAULT_CONFIGS = ["tsconfig.app.json", "tsconfig.json"];
const WORKSPACE_CONFIG_DIRS = ["apps", "packages"];
const WORKSPACE_CONFIG_NAMES = ["tsconfig.app.json", "tsconfig.json"];
const MAX_WORKSPACE_CONFIGS_TO_CHECK = 40;
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_WORKER_SESSIONS = 8;
const AVAILABILITY_CACHE_TTL_MS = 30_000;

interface WorkerSession {
  worker: Worker;
  queue: Promise<unknown>;
  idleTimer: NodeJS.Timeout | undefined;
  lastUsedAt: number;
}

const workerSessions = new Map<string, WorkerSession>();
const availabilityCache = new Map<
  string,
  { expiresAt: number; availability: CodeExplorerAvailability }
>();

export interface CodeExplorerAvailability {
  ready: boolean;
  reason: string | null;
  tsconfigPath: string | null;
}

export function isCodeExplorerReady(appPath: string): boolean {
  return getCodeExplorerAvailability(appPath).ready;
}

export function getCodeExplorerAvailability(
  appPath: string,
): CodeExplorerAvailability {
  const cacheKey = path.resolve(appPath);
  const cached = availabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.availability;
  }

  const availability = computeCodeExplorerAvailability(appPath);
  availabilityCache.set(cacheKey, {
    expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS,
    availability,
  });
  return availability;
}

function computeCodeExplorerAvailability(
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

export async function runCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerResult> {
  const key = workerSessionKey(input);
  const session = getWorkerSession(key);
  session.lastUsedAt = Date.now();
  clearIdleTimer(session);

  const run = session.queue
    .catch(() => undefined)
    .then(() => runCodeExplorerOnWorker(session.worker, input));
  session.queue = run
    .catch(() => undefined)
    .finally(() => {
      scheduleWorkerSessionCleanup(key, session);
    });
  return run;
}

function workerSessionKey(input: CodeExplorerWorkerInput): string {
  return `${path.resolve(input.appPath)}\0${input.tsconfigPath ?? ""}`;
}

function getWorkerSession(key: string): WorkerSession {
  const existing = workerSessions.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  pruneWorkerSessions();
  const workerPath = path.join(__dirname, "code_explorer_worker.js");
  const worker = new Worker(workerPath);
  const session: WorkerSession = {
    worker,
    queue: Promise.resolve(),
    idleTimer: undefined,
    lastUsedAt: Date.now(),
  };
  worker.on("error", (error) => {
    logger.error(`Code explorer worker error: ${error.message}`);
    clearIdleTimer(session);
    workerSessions.delete(key);
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      logger.warn(`Code explorer worker exited with code ${code}`);
    }
    clearIdleTimer(session);
    workerSessions.delete(key);
  });
  workerSessions.set(key, session);
  return session;
}

function pruneWorkerSessions(): void {
  while (workerSessions.size >= MAX_WORKER_SESSIONS) {
    const oldest = [...workerSessions.entries()].sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    )[0];
    if (!oldest) return;
    const [key, session] = oldest;
    clearIdleTimer(session);
    workerSessions.delete(key);
    void session.worker.terminate();
  }
}

function runCodeExplorerOnWorker(
  worker: Worker,
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerResult> {
  return new Promise((resolve, reject) => {
    const onMessage = (output: CodeExplorerWorkerOutput) => {
      cleanup();
      if (output.success) {
        resolve(output.data);
      } else {
        logger.error(
          `Code explorer worker failed for app ${input.appPath}: ${output.error}`,
        );
        reject(toCodeExplorerError(new Error(output.error)));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(toCodeExplorerError(error));
    };
    const onExit = (code: number) => {
      cleanup();
      if (code !== 0) {
        reject(
          toCodeExplorerError(new Error(`Worker exited with code ${code}`)),
        );
      } else {
        reject(toCodeExplorerError(new Error("Worker exited before replying")));
      }
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.postMessage(input);
  });
}

function clearIdleTimer(session: WorkerSession): void {
  if (!session.idleTimer) return;
  clearTimeout(session.idleTimer);
  session.idleTimer = undefined;
}

function scheduleWorkerSessionCleanup(
  key: string,
  session: WorkerSession,
): void {
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    workerSessions.delete(key);
    void session.worker.terminate();
  }, WORKER_IDLE_TIMEOUT_MS);
}
