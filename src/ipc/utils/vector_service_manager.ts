import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { VectorServiceState, VectorServiceStatus } from "../types/vector";
import { getUserDataPath } from "../../paths/paths";
import { killProcess } from "./process_manager";
import { findAvailablePort } from "./port_utils";

const logger = log.scope("vector_service");
const READY_TIMEOUT_MS = 25_000;
const READY_POLL_MS = 250;
const HEALTH_CHECK_MS = 5_000;
const MAX_FAILED_HEALTH_CHECKS = 3;
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
const RUNTIME_FILE = "runtime.json";

interface VectorRuntimeRecord {
  pid: number;
  httpPort: number;
  grpcPort: number;
  storagePath: string;
  startedAt: string;
}

let qdrantProcess: ChildProcess | null = null;
let qdrantPid: number | null = null;
let state: VectorServiceState = "stopped";
let lastError: string | null = null;
let httpPort: number | null = null;
let startPromise: Promise<VectorServiceStatus> | null = null;
let stopping = false;
let supervisorEnabled = false;
let healthCheckTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let restartAttempt = 0;
let failedHealthChecks = 0;
let healthCheckRunning = false;

function vectorRoot(): string {
  return path.join(getUserDataPath(), "vector");
}

function vectorRuntimePath(): string {
  return path.join(vectorRoot(), RUNTIME_FILE);
}

export function vectorStoragePath(): string {
  return path.join(vectorRoot(), "qdrant");
}

export function vectorMetadataPath(): string {
  return path.join(vectorRoot(), "workspace.json");
}

export function vectorBackupsPath(): string {
  return path.join(vectorRoot(), "backups");
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Some filesystems do not support POSIX permissions.
  }
}

function readRuntimeRecord(): VectorRuntimeRecord | null {
  try {
    const filePath = vectorRuntimePath();
    if (!fs.existsSync(filePath)) return null;
    const value = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<VectorRuntimeRecord>;
    if (
      !Number.isInteger(value.pid) ||
      !Number.isInteger(value.httpPort) ||
      !Number.isInteger(value.grpcPort) ||
      value.storagePath !== vectorStoragePath() ||
      typeof value.startedAt !== "string"
    ) {
      return null;
    }
    return value as VectorRuntimeRecord;
  } catch (error) {
    logger.warn("Could not read Vector runtime record", error);
    return null;
  }
}

function writeRuntimeRecord(record: VectorRuntimeRecord): void {
  ensurePrivateDirectory(vectorRoot());
  const filePath = vectorRuntimePath();
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function clearRuntimeRecord(expectedPid?: number): void {
  const record = readRuntimeRecord();
  if (expectedPid != null && record?.pid !== expectedPid) return;
  try {
    fs.unlinkSync(vectorRuntimePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Could not remove Vector runtime record", error);
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopRecordedProcess(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  logger.warn("Vector process ignored SIGTERM; forcing shutdown", { pid });
  process.kill(pid, "SIGKILL");
}

async function isVectorEndpointReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function vectorRestartDelay(attempt: number): number {
  return Math.min(
    RESTART_BASE_DELAY_MS * 2 ** Math.max(0, attempt),
    RESTART_MAX_DELAY_MS,
  );
}

function qdrantBinaryPath(): string {
  if (process.platform !== "darwin") {
    throw new DyadError(
      "The managed local Vector service is currently available on macOS.",
      DyadErrorKind.Precondition,
    );
  }
  const architecture = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  // `process.resourcesPath` and `app` only exist inside Electron; skip those
  // candidates when absent so the packaged/dev/cwd fallback chain still works.
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, "qdrant") : null,
    typeof app?.getAppPath === "function"
      ? path.join(app.getAppPath(), "assets", "qdrant")
      : null,
    path.join(process.cwd(), "assets", "qdrant"),
  ].filter((root): root is string => root !== null);
  const candidates = roots.map((root) =>
    path.join(root, architecture, "qdrant"),
  );
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  if (!binary) {
    throw new DyadError(
      "The managed Vector engine is missing from this installation.",
      DyadErrorKind.NotFound,
    );
  }
  return binary;
}

export function getVectorServiceStatus(): VectorServiceStatus {
  const messages: Record<VectorServiceState, string> = {
    stopped: "Vector is off",
    starting: "Starting the private local index…",
    ready: "Ready on this Mac",
    indexing: "Indexing local knowledge…",
    attention: "Vector needs attention",
  };
  return {
    state,
    message: messages[state],
    localOnly: true,
    error: state === "attention" ? lastError : null,
  };
}

export function setVectorIndexing(indexing: boolean): void {
  if (indexing && state === "ready") state = "indexing";
  if (!indexing && state === "indexing") state = "ready";
}

function stopHealthChecks(): void {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = null;
  healthCheckRunning = false;
  failedHealthChecks = 0;
}

function scheduleVectorRestart(reason: string): void {
  if (!supervisorEnabled || stopping || restartTimer) return;
  state = "attention";
  lastError = reason;
  const delay = vectorRestartDelay(restartAttempt);
  restartAttempt += 1;
  logger.warn(`Vector health recovery scheduled in ${delay}ms: ${reason}`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartVectorService().catch((error) => {
      scheduleVectorRestart(
        error instanceof Error ? error.message : "Vector restart failed.",
      );
    });
  }, delay);
  restartTimer.unref();
}

function startHealthChecks(): void {
  stopHealthChecks();
  healthCheckTimer = setInterval(() => {
    if (healthCheckRunning || httpPort == null || stopping) return;
    healthCheckRunning = true;
    void isVectorEndpointReady(httpPort)
      .then((healthy) => {
        if (healthy) {
          failedHealthChecks = 0;
          if (state === "attention") state = "ready";
          return;
        }
        failedHealthChecks += 1;
        if (failedHealthChecks >= MAX_FAILED_HEALTH_CHECKS) {
          stopHealthChecks();
          scheduleVectorRestart(
            "The local Vector engine stopped responding and is being restarted.",
          );
        }
      })
      .finally(() => {
        healthCheckRunning = false;
      });
  }, HEALTH_CHECK_MS);
  healthCheckTimer.unref();
}

async function adoptExistingVectorService(): Promise<boolean> {
  const runtime = readRuntimeRecord();
  if (!runtime) return false;
  if (!isProcessAlive(runtime.pid)) {
    clearRuntimeRecord(runtime.pid);
    return false;
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await isVectorEndpointReady(runtime.httpPort)) {
      qdrantProcess = null;
      qdrantPid = runtime.pid;
      httpPort = runtime.httpPort;
      state = "ready";
      lastError = null;
      restartAttempt = 0;
      logger.info("Adopted existing managed local Vector engine", {
        pid: runtime.pid,
        port: runtime.httpPort,
      });
      startHealthChecks();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  logger.warn("Stopping stale managed Vector process", { pid: runtime.pid });
  try {
    await stopRecordedProcess(runtime.pid);
  } catch {
    // It may have exited between the liveness check and the signal.
  }
  clearRuntimeRecord(runtime.pid);
  return false;
}

async function waitUntilReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (qdrantProcess !== child || child.exitCode != null || httpPort == null) {
      throw new DyadError(
        "The local Vector engine stopped while starting.",
        DyadErrorKind.External,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/readyz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        state = "ready";
        lastError = null;
        return;
      }
    } catch {
      // The process is still warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new DyadError(
    "The local Vector engine took too long to start.",
    DyadErrorKind.External,
  );
}

export async function startVectorService(): Promise<VectorServiceStatus> {
  if (state === "ready" || state === "indexing") {
    return getVectorServiceStatus();
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    ensurePrivateDirectory(vectorRoot());
    ensurePrivateDirectory(vectorStoragePath());
    ensurePrivateDirectory(vectorBackupsPath());

    if (await adoptExistingVectorService()) {
      return getVectorServiceStatus();
    }

    const [nextHttpPort, grpcPort] = await Promise.all([
      findAvailablePort(45100, 45999),
      findAvailablePort(46000, 46899),
    ]);
    httpPort = nextHttpPort;
    state = "starting";
    lastError = null;
    stopping = false;

    const binary = qdrantBinaryPath();
    logger.info("Starting managed local Vector engine");
    const child = spawn(binary, ["--disable-telemetry"], {
      cwd: vectorRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        QDRANT__SERVICE__HOST: "127.0.0.1",
        QDRANT__SERVICE__HTTP_PORT: String(nextHttpPort),
        QDRANT__SERVICE__GRPC_PORT: String(grpcPort),
        QDRANT__STORAGE__STORAGE_PATH: vectorStoragePath(),
        QDRANT__TELEMETRY_DISABLED: "true",
      },
    });
    qdrantProcess = child;
    qdrantPid = child.pid ?? null;
    if (child.pid != null) {
      writeRuntimeRecord({
        pid: child.pid,
        httpPort: nextHttpPort,
        grpcPort,
        storagePath: vectorStoragePath(),
        startedAt: new Date().toISOString(),
      });
    }

    child.stdout?.on("data", (data: Buffer) =>
      logger.debug(data.toString().trim()),
    );
    child.stderr?.on("data", (data: Buffer) =>
      logger.debug(data.toString().trim()),
    );
    child.on("error", (error) => {
      if (qdrantProcess !== child) return;
      qdrantProcess = null;
      qdrantPid = null;
      state = "attention";
      lastError = `Vector could not start: ${error.message}`;
      if (child.pid != null) clearRuntimeRecord(child.pid);
      scheduleVectorRestart(lastError);
    });
    child.on("exit", (code) => {
      if (qdrantProcess !== child) return;
      qdrantProcess = null;
      qdrantPid = null;
      httpPort = null;
      stopHealthChecks();
      if (child.pid != null) clearRuntimeRecord(child.pid);
      if (stopping || code === 0) {
        state = "stopped";
      } else {
        state = "attention";
        lastError = "The local Vector engine stopped unexpectedly.";
        scheduleVectorRestart(lastError);
      }
      stopping = false;
    });

    try {
      await waitUntilReady(child);
      if (child.pid == null) {
        throw new DyadError(
          "The local Vector engine started without a process identifier.",
          DyadErrorKind.External,
        );
      }
      restartAttempt = 0;
      startHealthChecks();
      return getVectorServiceStatus();
    } catch (error) {
      state = "attention";
      lastError =
        error instanceof Error ? error.message : "Vector could not start.";
      if (qdrantProcess === child) {
        await stopVectorService();
        state = "attention";
      }
      throw error;
    }
  })().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

export async function stopVectorService(): Promise<VectorServiceStatus> {
  const child = qdrantProcess;
  const pid = qdrantPid;
  if (!child && pid == null) {
    httpPort = null;
    if (state !== "attention") state = "stopped";
    return getVectorServiceStatus();
  }
  stopping = true;
  stopHealthChecks();
  try {
    if (child) {
      await killProcess(child);
    } else if (pid != null && isProcessAlive(pid)) {
      await stopRecordedProcess(pid);
    }
  } catch (error) {
    logger.warn("Vector engine did not stop cleanly", error);
  }
  if (qdrantProcess === child) qdrantProcess = null;
  qdrantPid = null;
  clearRuntimeRecord(pid ?? undefined);
  httpPort = null;
  state = "stopped";
  stopping = false;
  return getVectorServiceStatus();
}

export async function restartVectorService(): Promise<VectorServiceStatus> {
  await stopVectorService();
  return startVectorService();
}

export function startVectorServiceSupervisor(): void {
  if (supervisorEnabled) return;
  supervisorEnabled = true;
  const start = () => {
    void startVectorService().catch((error) => {
      scheduleVectorRestart(
        error instanceof Error ? error.message : "Vector could not start.",
      );
    });
  };
  if (typeof app?.isReady === "function" && app.isReady()) {
    start();
  } else if (typeof app?.whenReady === "function") {
    void app.whenReady().then(start);
  }
}

export function stopVectorServiceSupervisor(): void {
  supervisorEnabled = false;
  stopping = true;
  stopHealthChecks();
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;

  // Electron does not await before-quit listeners. Signal synchronously and
  // keep the runtime record so a fast development reload can adopt the process
  // if it has not finished shutting down yet.
  const pid = qdrantPid ?? qdrantProcess?.pid;
  if (pid != null && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      logger.warn("Could not signal Vector engine during shutdown", error);
    }
  }
}

export async function vectorRequest<T>(
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  await startVectorService();
  if (httpPort == null) {
    throw new DyadError(
      "The local Vector engine is not available.",
      DyadErrorKind.Precondition,
    );
  }
  const response = await fetch(`http://127.0.0.1:${httpPort}${endpoint}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new DyadError(
      `Vector operation failed (${response.status}): ${detail.slice(0, 400)}`,
      DyadErrorKind.External,
    );
  }
  return (await response.json()) as T;
}
