import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { app } from "electron";
import log from "electron-log";

import { createTypedHandler } from "./base";
import {
  openWorkerContracts,
  type OpenWorkerStatus,
} from "../types/openworker";
import { killProcess } from "../utils/process_manager";
import { readSettings } from "../../main/settings";
import { getUserDataPath } from "../../paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getEnvVar } from "../utils/read_env";
import { blockedPortMessage, decideStartAction } from "../utils/managed_server";
import {
  contentTypeFor,
  injectRuntimeConfig,
  isAuthorisedRequest,
  resolveAssetPath,
  stripNonce,
} from "../utils/openworker_gui";

const logger = log.scope("openworker_handlers");

/**
 * OpenWorker is hosted, not launched standalone: Meta Human OS owns the agent
 * server's lifetime and serves OpenWorker's own UI into a tab, pointing it at
 * that server through the runtime globals its Tauri shell also uses.
 */
const AGENT_PORT = 31200;
const GUI_PORT = 31201;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 750;
const MAX_OUTPUT_LINES = 80;

type State = OpenWorkerStatus["state"];

let agentProcess: ChildProcess | null = null;
let guiServer: http.Server | null = null;
let launchToken: string | null = null;
let guiNonce: string | null = null;
let state: State = "stopped";
let lastError: string | null = null;
let stopping = false;
const outputBuffer: string[] = [];

/** The checkout, kept beside the Helix app so both live at the repo root. */
function getOpenWorkerDir(): string | null {
  const candidates = [
    path.join(app.getAppPath(), "openworker"),
    path.join(getUserDataPath(), "openworker"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "pyproject.toml"))) return dir;
  }
  return null;
}

function serverBinary(dir: string): string {
  return process.platform === "win32"
    ? path.join(dir, ".venv", "Scripts", "openworker-server.exe")
    : path.join(dir, ".venv", "bin", "openworker-server");
}

function guiDistDir(dir: string): string {
  return path.join(dir, "surfaces", "gui", "dist");
}

function isVenvReady(dir: string | null): boolean {
  return dir != null && fs.existsSync(serverBinary(dir));
}

function isGuiBuilt(dir: string | null): boolean {
  return dir != null && fs.existsSync(path.join(guiDistDir(dir), "index.html"));
}

function pidFile(): string {
  return path.join(getUserDataPath(), "openworker-server.pid");
}

function rememberPid(pid: number | undefined): void {
  if (pid == null) return;
  try {
    fs.writeFileSync(pidFile(), String(pid), "utf8");
  } catch (error) {
    logger.warn("Could not record the OpenWorker PID:", error);
  }
}

function forgetPid(): void {
  try {
    fs.rmSync(pidFile(), { force: true });
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Confirms a live PID is really our agent server before we signal it. PIDs are
 * recycled, and a bare number would eventually name an unrelated process.
 */
function looksLikeOpenWorker(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    return command.includes("openworker-server");
  } catch {
    return false;
  }
}

function readOwnedPid(): number | null {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(pidFile(), "utf8").trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return looksLikeOpenWorker(pid) ? pid : null;
}

function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once("error", (error: NodeJS.ErrnoException) => {
        resolve(error.code === "EADDRINUSE");
      })
      .once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

/** `/v1/health` needs no token, which makes it a clean liveness probe. */
async function isAgentHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${AGENT_PORT}/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

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
    if (trimmed) outputBuffer.push(trimmed);
  }
  if (outputBuffer.length > MAX_OUTPUT_LINES) {
    outputBuffer.splice(0, outputBuffer.length - MAX_OUTPUT_LINES);
  }
}

/**
 * The model key handed to the agent.
 *
 * OpenWorker talks to providers directly, so it needs a key of its own. It is
 * passed through the environment of the child process — never to the renderer,
 * and never written into any page except the launch token below.
 */
function resolveModelKey(): { env: Record<string, string>; found: boolean } {
  const settings = readSettings();
  const env: Record<string, string> = {};
  const anthropic =
    settings.providerSettings?.anthropic?.apiKey?.value ||
    getEnvVar("ANTHROPIC_API_KEY");
  const openai =
    settings.providerSettings?.openai?.apiKey?.value ||
    getEnvVar("OPENAI_API_KEY");
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  if (openai) env.OPENAI_API_KEY = openai;
  return { env, found: Boolean(anthropic || openai) };
}

function guiUrl(): string | null {
  if (!guiNonce) return null;
  return `http://127.0.0.1:${GUI_PORT}/${guiNonce}/`;
}

function buildStatus(): OpenWorkerStatus {
  const dir = getOpenWorkerDir();
  return {
    state,
    url: state === "running" ? guiUrl() : null,
    appFound: dir != null,
    venvReady: isVenvReady(dir),
    guiBuilt: isGuiBuilt(dir),
    appDir: dir,
    hasModelKey: resolveModelKey().found,
    error: state === "error" ? lastError : null,
    recentOutput: outputBuffer.slice(-12),
  };
}

/**
 * Serves OpenWorker's built UI with the backend coordinates injected.
 *
 * Bound to loopback and gated on an unguessable path, because the launch token
 * travels inside the served HTML.
 */
function startGuiServer(distDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const server = http.createServer((req, res) => {
      const requestPath = req.url ?? "/";
      if (!isAuthorisedRequest(requestPath, nonce)) {
        res.writeHead(404).end();
        return;
      }
      const inner = stripNonce(requestPath, nonce);
      const filePath = resolveAssetPath(distDir, inner);
      if (!filePath) {
        res.writeHead(403).end();
        return;
      }

      // A single-page app: unknown paths fall back to the entry document.
      const target =
        fs.existsSync(filePath) && fs.statSync(filePath).isFile()
          ? filePath
          : path.join(distDir, "index.html");

      fs.readFile(target, (error, data) => {
        if (error) {
          res.writeHead(404).end();
          return;
        }
        if (target.endsWith("index.html")) {
          const html = injectRuntimeConfig(data.toString("utf8"), {
            httpBase: `http://127.0.0.1:${AGENT_PORT}`,
            wsBase: `ws://127.0.0.1:${AGENT_PORT}`,
            token: launchToken ?? "",
          });
          res
            .writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              // The token is in this document; it must not be cached to disk.
              "Cache-Control": "no-store",
            })
            .end(html);
          return;
        }
        res
          .writeHead(200, { "Content-Type": contentTypeFor(target) })
          .end(data);
      });
    });

    server.once("error", reject);
    server.listen(GUI_PORT, "127.0.0.1", () => {
      guiServer = server;
      guiNonce = nonce;
      resolve();
    });
  });
}

function stopGuiServer(): void {
  guiServer?.close();
  guiServer = null;
  guiNonce = null;
}

async function waitUntilReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (agentProcess !== child || child.exitCode != null) return;
    if (await isAgentHealthy()) {
      if (agentProcess === child && state === "starting") {
        state = "running";
        logger.log(`OpenWorker agent is ready on port ${AGENT_PORT}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  if (agentProcess === child && state === "starting") {
    state = "error";
    lastError = `OpenWorker did not become ready within ${
      READY_TIMEOUT_MS / 1000
    }s. Check the server output below.`;
    logger.error(lastError);
  }
}

async function startOpenWorker(): Promise<OpenWorkerStatus> {
  if (state === "running" || state === "starting") return buildStatus();

  const dir = getOpenWorkerDir();
  if (!dir) {
    throw new DyadError(
      "The OpenWorker app was not found. Clone it into the openworker folder first.",
      DyadErrorKind.NotFound,
    );
  }
  if (!isVenvReady(dir)) {
    throw new DyadError(
      'OpenWorker needs its one-time Python setup. Run "bash packaging/setup_dev_env.sh" inside the openworker folder.',
      DyadErrorKind.NotFound,
    );
  }
  if (!isGuiBuilt(dir)) {
    throw new DyadError(
      'OpenWorker\'s interface has not been built. Run "npm install && npm run build" in openworker/surfaces/gui.',
      DyadErrorKind.NotFound,
    );
  }

  const action = decideStartAction({
    portBusy: await isPortBusy(AGENT_PORT),
    healthy: await isAgentHealthy(),
    ownedPidAlive: readOwnedPid() != null,
  });

  if (action === "blocked") {
    state = "error";
    lastError = blockedPortMessage("OpenWorker", AGENT_PORT);
    logger.error(lastError);
    throw new DyadError(lastError, DyadErrorKind.Unknown);
  }

  if (action === "reclaim") {
    const stale = readOwnedPid();
    logger.log(`Stopping a stale OpenWorker agent (PID ${stale}).`);
    try {
      if (stale != null) process.kill(stale, "SIGTERM");
    } catch (error) {
      logger.warn("Could not stop the stale OpenWorker agent:", error);
    }
    forgetPid();
    if (!(await waitForPortFree(AGENT_PORT))) {
      state = "error";
      lastError = blockedPortMessage("OpenWorker", AGENT_PORT);
      throw new DyadError(lastError, DyadErrorKind.Unknown);
    }
  }

  stopping = false;
  state = "starting";
  lastError = null;
  outputBuffer.length = 0;
  // A fresh secret per launch, exactly like the standalone server's own
  // per-launch token — but held in memory rather than written to disk.
  launchToken = crypto.randomBytes(32).toString("hex");

  if (action !== "adopt") {
    const { env: modelEnv } = resolveModelKey();
    const workspace = readSettings().storage?.localVaultPath?.trim();
    logger.log(`Starting OpenWorker agent on port ${AGENT_PORT}`);
    const child = spawn(
      serverBinary(dir),
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(AGENT_PORT),
        ...(workspace ? ["--cwd", workspace] : []),
      ],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, ...modelEnv, COWORKER_API_TOKEN: launchToken },
      },
    );
    agentProcess = child;
    rememberPid(child.pid);

    child.stdout?.on("data", (data: Buffer) => pushOutput(data.toString()));
    child.stderr?.on("data", (data: Buffer) => pushOutput(data.toString()));

    child.on("error", (error) => {
      if (agentProcess !== child) return;
      agentProcess = null;
      state = "error";
      lastError = `Failed to launch OpenWorker: ${error.message}`;
      logger.error(lastError);
    });

    child.on("exit", (code) => {
      if (agentProcess !== child) return;
      agentProcess = null;
      forgetPid();
      stopGuiServer();
      if (stopping || code === 0) {
        state = "stopped";
      } else {
        state = "error";
        lastError = `OpenWorker exited unexpectedly (code ${code ?? "unknown"}).`;
        logger.error(lastError);
      }
      stopping = false;
    });

    void waitUntilReady(child);
  } else {
    // Adopting an already-running agent we did not spawn: we cannot know its
    // token, so the UI would be refused. Better to say so than show a broken
    // page.
    state = "error";
    lastError = blockedPortMessage("OpenWorker", AGENT_PORT);
    throw new DyadError(lastError, DyadErrorKind.Unknown);
  }

  stopGuiServer();
  try {
    await startGuiServer(guiDistDir(dir));
  } catch (error) {
    state = "error";
    lastError = `Could not serve the OpenWorker interface on port ${GUI_PORT}.`;
    logger.error(lastError, error);
    throw new DyadError(lastError, DyadErrorKind.Unknown);
  }

  return buildStatus();
}

async function stopOpenWorker(): Promise<OpenWorkerStatus> {
  stopGuiServer();
  launchToken = null;

  const child = agentProcess;
  if (!child) {
    const owned = readOwnedPid();
    if (owned != null) {
      logger.log(`Stopping the adopted OpenWorker agent (PID ${owned}).`);
      try {
        process.kill(owned, "SIGTERM");
      } catch (error) {
        logger.warn("Could not stop the adopted OpenWorker agent:", error);
      }
      forgetPid();
    }
    if (state !== "error") state = "stopped";
    return buildStatus();
  }

  stopping = true;
  logger.log(`Stopping OpenWorker (PID ${child.pid ?? "unknown"})`);
  try {
    await killProcess(child);
  } catch (error) {
    logger.warn("Error while stopping OpenWorker:", error);
  }
  if (agentProcess === child) agentProcess = null;
  forgetPid();
  state = "stopped";
  stopping = false;
  return buildStatus();
}

export function registerOpenWorkerHandlers() {
  createTypedHandler(openWorkerContracts.getStatus, async () => buildStatus());
  createTypedHandler(openWorkerContracts.start, async () => startOpenWorker());
  createTypedHandler(openWorkerContracts.stop, async () => stopOpenWorker());

  app.on("before-quit", () => {
    if (agentProcess || guiServer) void stopOpenWorker();
  });
}
