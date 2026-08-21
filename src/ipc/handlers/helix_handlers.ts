import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { app } from "electron";
import log from "electron-log";

import { createTypedHandler } from "./base";
import { helixContracts, type HelixStatus } from "../types/helix";
import { killProcess } from "../utils/process_manager";
import { readSettings } from "../../main/settings";
import { getUserDataPath } from "../../paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getEnvVar } from "../utils/read_env";
import { blockedPortMessage, decideStartAction } from "../utils/managed_server";

const logger = log.scope("helix_handlers");

const HELIX_PORT = 31100;
const HELIX_PATH = "/agent";
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 1_000;
const MAX_OUTPUT_LINES = 80;

type HelixState = HelixStatus["state"];

let helixProcess: ChildProcess | null = null;
let state: HelixState = "stopped";
let lastError: string | null = null;
let stopping = false;
const outputBuffer: string[] = [];

/** Managed Helix copy used by packaged builds (userData is always writable). */
function getManagedHelixDir(): string {
  return path.join(getUserDataPath(), "helix-app");
}

/**
 * Resolve the Helix app folder. In dev, `app.getAppPath()` is the repo root so
 * `aios/` is right there; packaged builds can't run a dev server from inside
 * the asar, so they use the managed copy in userData instead.
 */
function getHelixDir(): string | null {
  const candidates = [
    path.join(app.getAppPath(), "aios"),
    getManagedHelixDir(),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
  }
  return null;
}

function helixUrl(): string {
  return `http://localhost:${HELIX_PORT}${HELIX_PATH}`;
}

/**
 * Where the spawned dev server's PID is remembered.
 *
 * The point is to survive our own death: after a crash the only way to tell
 * "our orphaned server" from "somebody else's program" is to have written the
 * PID down while we still could.
 */
function helixPidFile(): string {
  return path.join(getUserDataPath(), "helix-dev-server.pid");
}

function rememberHelixPid(pid: number | undefined): void {
  if (pid == null) return;
  try {
    fs.writeFileSync(helixPidFile(), String(pid), "utf8");
  } catch (error) {
    // Losing the note only costs us the ability to auto-reclaim later.
    logger.warn("Could not record the Helix PID:", error);
  }
}

function forgetHelixPid(): void {
  try {
    fs.rmSync(helixPidFile(), { force: true });
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Confirms a live PID is really our dev server before we signal it.
 *
 * PIDs get recycled, and a recorded number alone would eventually point at
 * some unrelated process — which we would then terminate. Checking the command
 * line costs one `ps` call per start and removes that risk entirely.
 */
function looksLikeHelixProcess(pid: number): boolean {
  if (process.platform === "win32") {
    // No cheap equivalent here; treat the record as unverifiable rather than
    // risk signalling the wrong process.
    return false;
  }
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    return command.includes("next") && command.includes(String(HELIX_PORT));
  } catch {
    return false;
  }
}

/** The PID we last spawned, if that process is still alive and still ours. */
function readOwnedHelixPid(): number | null {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(helixPidFile(), "utf8").trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return looksLikeHelixProcess(pid) ? pid : null;
}

/** Is anything listening on the Helix port? */
function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once("error", (error: NodeJS.ErrnoException) => {
        resolve(error.code === "EADDRINUSE");
      })
      .once("listening", () => {
        probe.close(() => resolve(false));
      });
    probe.listen(port, "0.0.0.0");
  });
}

/** Does whatever holds the port answer like Helix? */
async function isHelixHealthy(): Promise<boolean> {
  try {
    const response = await fetch(helixUrl(), {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** Waits for a released port, so the respawn does not race the shutdown. */
async function waitForPortFree(port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortBusy(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function pushOutput(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    outputBuffer.push(trimmed);
  }
  if (outputBuffer.length > MAX_OUTPUT_LINES) {
    outputBuffer.splice(0, outputBuffer.length - MAX_OUTPUT_LINES);
  }
}

function buildStatus(): HelixStatus {
  const settings = readSettings();
  const helixDir = getHelixDir();
  const gatewayKey =
    settings.providerSettings?.vercel?.apiKey?.value ||
    settings.vercelAiGatewayApiKey?.value ||
    getEnvVar("AI_GATEWAY_API_KEY");
  return {
    state,
    url: state === "running" ? helixUrl() : null,
    port: HELIX_PORT,
    hasGatewayKey: Boolean(gatewayKey),
    appFound: helixDir != null,
    appDir: helixDir,
    managedDir: getManagedHelixDir(),
    error: state === "error" ? lastError : null,
    recentOutput: outputBuffer.slice(-12),
  };
}

/** Poll the dev server until it answers, then flip state to "running". */
async function waitUntilReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // The process died while we were waiting — exit handler set the state.
    if (helixProcess !== child || child.exitCode != null) {
      return;
    }
    try {
      const response = await fetch(helixUrl(), {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok || response.status === 404) {
        if (helixProcess === child && state === "starting") {
          state = "running";
          logger.log(`Helix is ready at ${helixUrl()}`);
        }
        return;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  if (helixProcess === child && state === "starting") {
    state = "error";
    lastError = `Helix did not become ready within ${READY_TIMEOUT_MS / 1000}s. Check the server output below.`;
    logger.error(lastError);
  }
}

async function startHelix(): Promise<HelixStatus> {
  if (state === "running" || state === "starting") {
    return buildStatus();
  }

  const dir = getHelixDir();
  if (!dir) {
    throw new DyadError(
      `The Helix app was not found. Copy the helix (aios) folder to ${getManagedHelixDir()}.`,
      DyadErrorKind.NotFound,
    );
  }
  const isWindows = process.platform === "win32";
  const nextBin = path.join(
    dir,
    "node_modules",
    ".bin",
    isWindows ? "next.cmd" : "next",
  );
  if (!fs.existsSync(nextBin)) {
    throw new DyadError(
      `Helix dependencies are not installed. Run "pnpm install" in ${dir} first.`,
      DyadErrorKind.NotFound,
    );
  }
  logger.log(`Using Helix app at ${dir}`);

  // A busy port is the normal aftermath of a crash or a force-quit, not a
  // reason to fail: adopt a server that works, replace one of ours that does
  // not, and only give up when the port belongs to something else.
  const action = decideStartAction({
    portBusy: await isPortBusy(HELIX_PORT),
    healthy: await isHelixHealthy(),
    ownedPidAlive: readOwnedHelixPid() != null,
  });

  if (action === "adopt") {
    logger.log(`Helix is already serving on port ${HELIX_PORT}; using it.`);
    helixProcess = null;
    state = "running";
    lastError = null;
    return buildStatus();
  }

  if (action === "blocked") {
    state = "error";
    lastError = blockedPortMessage("Helix", HELIX_PORT);
    logger.error(lastError);
    throw new DyadError(lastError, DyadErrorKind.Unknown);
  }

  if (action === "reclaim") {
    const stale = readOwnedHelixPid();
    logger.log(
      `Stopping a stale Helix server from a previous run (PID ${stale}).`,
    );
    try {
      if (stale != null) process.kill(stale, "SIGTERM");
    } catch (error) {
      logger.warn("Could not stop the stale Helix server:", error);
    }
    forgetHelixPid();
    if (!(await waitForPortFree(HELIX_PORT))) {
      state = "error";
      lastError = blockedPortMessage("Helix", HELIX_PORT);
      logger.error(
        `Port ${HELIX_PORT} did not free up after stopping PID ${stale}.`,
      );
      throw new DyadError(lastError, DyadErrorKind.Unknown);
    }
  }

  const settings = readSettings();
  const gatewayKey =
    settings.providerSettings?.vercel?.apiKey?.value ||
    settings.vercelAiGatewayApiKey?.value ||
    getEnvVar("AI_GATEWAY_API_KEY");

  stopping = false;
  state = "starting";
  lastError = null;
  outputBuffer.length = 0;

  logger.log(`Starting Helix from ${dir} on port ${HELIX_PORT}`);
  const child = spawn(
    nextBin,
    ["dev", "--turbopack", "--port", String(HELIX_PORT)],
    {
      cwd: dir,
      // .cmd shims must run through a shell on Windows.
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(gatewayKey ? { AI_GATEWAY_API_KEY: gatewayKey } : {}),
        PORT: String(HELIX_PORT),
        BROWSER: "none",
        FORCE_COLOR: "0",
      },
    },
  );
  helixProcess = child;
  // Written now so a crash before the next graceful stop still leaves us able
  // to recognise this server as ours.
  rememberHelixPid(child.pid);

  child.stdout?.on("data", (data: Buffer) => pushOutput(data.toString()));
  child.stderr?.on("data", (data: Buffer) => pushOutput(data.toString()));

  child.on("error", (error) => {
    if (helixProcess !== child) return;
    helixProcess = null;
    state = "error";
    lastError = `Failed to launch Helix: ${error.message}`;
    logger.error(lastError);
  });

  child.on("exit", (code) => {
    if (helixProcess !== child) return;
    helixProcess = null;
    forgetHelixPid();
    if (stopping || code === 0) {
      state = "stopped";
    } else {
      state = "error";
      lastError = `Helix exited unexpectedly (code ${code ?? "unknown"}).`;
      logger.error(lastError);
    }
    stopping = false;
  });

  void waitUntilReady(child);
  return buildStatus();
}

async function stopHelix(): Promise<HelixStatus> {
  const child = helixProcess;
  if (!child) {
    // An adopted server has no child handle, but it is still ours if we
    // recorded its PID — otherwise Stop would leave it serving and the next
    // start would adopt it straight back.
    const owned = readOwnedHelixPid();
    if (owned != null) {
      logger.log(`Stopping the adopted Helix server (PID ${owned}).`);
      try {
        process.kill(owned, "SIGTERM");
      } catch (error) {
        logger.warn("Could not stop the adopted Helix server:", error);
      }
      forgetHelixPid();
    }
    if (state !== "error") {
      state = "stopped";
    }
    return buildStatus();
  }
  stopping = true;
  logger.log(`Stopping Helix (PID ${child.pid ?? "unknown"})`);
  try {
    await killProcess(child);
  } catch (error) {
    logger.warn("Error while stopping Helix:", error);
  }
  if (helixProcess === child) {
    helixProcess = null;
  }
  forgetHelixPid();
  state = "stopped";
  stopping = false;
  return buildStatus();
}

export function registerHelixHandlers() {
  createTypedHandler(helixContracts.getStatus, async () => buildStatus());
  createTypedHandler(helixContracts.start, async () => startHelix());
  createTypedHandler(helixContracts.stop, async () => stopHelix());

  // Make sure the dev server doesn't outlive the app.
  app.on("before-quit", () => {
    if (helixProcess) {
      void stopHelix();
    }
  });
}
