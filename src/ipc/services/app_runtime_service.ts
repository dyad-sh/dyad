import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import fixPath from "fix-path";
import killPort from "kill-port";
import log from "electron-log";

import { getAppPort, getAppProxyPort } from "../../../shared/ports";
import { readSettings } from "@/main/settings";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type RuntimeMode2,
} from "@/lib/schemas";
import type { AppOutput } from "@/ipc/types/misc";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { addLog } from "@/lib/log_store";
import { safeSend } from "@/ipc/utils/safe_sender";
import { startProxy } from "@/ipc/utils/start_proxy_server";
import {
  buildCloudSandboxFileMap,
  CloudSandboxApiError,
  createCloudSandbox,
  destroyCloudSandbox,
  registerRunningCloudSandbox,
  setCloudSandboxSyncUpdateListener,
  streamCloudSandboxLogs,
  uploadCloudSandboxFiles,
} from "@/ipc/utils/cloud_sandbox_provider";
import {
  processCounter,
  removeAppIfCurrentProcess,
  runningApps,
} from "@/ipc/utils/process_manager";
import {
  ensurePnpmAllowBuildsConfigured,
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  isPnpmIgnoredBuildsError,
  parsePnpmIgnoredBuildsFromOutput,
  type PackageManager,
  PNPM_PM_ON_FAIL_IGNORE_ARG,
  PNPM_INSTALL_POLICY_ARGS,
  getBestEffortPnpmRebuildCommand,
} from "@/ipc/utils/socket_firewall";
import {
  recordAndReportDeniedPnpmBuilds,
  resolvePnpmIgnoredBuilds,
} from "@/ipc/utils/pnpm_denied_builds";
import {
  getManagedPnpmMajorVersion,
  isPnpmVersionMigrationNeeded,
} from "@/ipc/utils/pnpm_migration";
import {
  choosePackageManagerFromSignal,
  getPackageManagerSignal,
  signalPrefersPnpm,
} from "@/ipc/utils/package_manager_selection";

const logger = log.scope("app_runtime_service");

// Needed, otherwise Electron on macOS/Linux may not find node/pnpm.
fixPath();

export function formatCloudSandboxError(error: unknown) {
  if (!(error instanceof CloudSandboxApiError)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.code) {
    case "sandbox_pro_required":
      return "Dyad Pro is required to use cloud sandboxes.";
    case "sandbox_insufficient_credits":
      return "You need at least 1 credit available to start a cloud sandbox.";
    case "sandbox_billing_unavailable":
      return "Dyad couldn’t verify sandbox billing right now. Please try again.";
    case "sandbox_credits_exhausted":
      return "This cloud sandbox stopped because your credits ran out.";
    default:
      if (error.status === 404) {
        return "This cloud sandbox is no longer available.";
      }
      if (error.status === 401 || error.status === 403) {
        return "Dyad couldn’t authorize the cloud sandbox request. Please try again.";
      }
      if (error.status === 429) {
        return "Dyad is rate limiting cloud sandbox requests right now. Please try again.";
      }
      if (typeof error.status === "number" && error.status >= 500) {
        return "Dyad’s cloud sandbox service is temporarily unavailable. Please try again.";
      }
      return error.message;
  }
}

function getPnpmInstallCommand(): string {
  return `pnpm ${PNPM_INSTALL_POLICY_ARGS.join(" ")} install`;
}

function getPnpmRunCommand(): string {
  return `pnpm ${PNPM_PM_ON_FAIL_IGNORE_ARG} run dev`;
}

function buildPnpmInstallAndRunCommand(input: {
  promotedPackages: string[];
  port: number;
}): string {
  return [
    getPnpmInstallCommand(),
    getBestEffortPnpmRebuildCommand(input.promotedPackages),
    `${getPnpmRunCommand()} --port ${input.port}`,
  ]
    .filter(Boolean)
    .join(" && ");
}

function getNpmInstallCommand(): string {
  return "npm install --legacy-peer-deps";
}

interface AppRuntimeCommand {
  command: string;
  isCustom: boolean;
  packageManager: PackageManager | null;
}

async function getDefaultCommand({
  runtimeMode,
  appId,
  appPath,
  onPnpmMinimumReleaseAgeWarning,
}: {
  runtimeMode: RuntimeMode2;
  appId: number;
  appPath: string;
  onPnpmMinimumReleaseAgeWarning?: (message: string) => void;
}): Promise<AppRuntimeCommand> {
  const port = getAppPort(appId);
  if (runtimeMode === "docker") {
    const allowBuildsResult = await ensurePnpmAllowBuildsConfigured({
      appPath,
    });
    return {
      command: buildPnpmInstallAndRunCommand({
        promotedPackages: allowBuildsResult.promotedPackages,
        port,
      }),
      isCustom: false,
      packageManager: "pnpm",
    };
  }

  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  const signal = getPackageManagerSignal(appPath);
  const packageManager = choosePackageManagerFromSignal({
    signal,
    pnpmAvailable: pnpmSupport.available,
  });

  // Only warn about pnpm when the app actually wants pnpm — including while
  // it temporarily falls back to npm because pnpm is missing/too old. Apps
  // that explicitly select npm should not see pnpm warnings.
  if (
    signalPrefersPnpm(signal) &&
    !pnpmSupport.minimumReleaseAgeSupported &&
    pnpmSupport.warningMessage
  ) {
    onPnpmMinimumReleaseAgeWarning?.(pnpmSupport.warningMessage);
  }

  if (packageManager === "npm") {
    return {
      command: `(${getNpmInstallCommand()} && npm run dev -- --port ${port})`,
      isCustom: false,
      packageManager: "npm",
    };
  }

  const allowBuildsResult = await ensurePnpmAllowBuildsConfigured({ appPath });
  return {
    command: buildPnpmInstallAndRunCommand({
      promotedPackages: allowBuildsResult.promotedPackages,
      port,
    }),
    isCustom: false,
    packageManager: "pnpm",
  };
}

async function getCommand({
  runtimeMode,
  appId,
  appPath,
  installCommand,
  startCommand,
  onPnpmMinimumReleaseAgeWarning,
}: {
  runtimeMode: RuntimeMode2;
  appId: number;
  appPath: string;
  installCommand?: string | null;
  startCommand?: string | null;
  onPnpmMinimumReleaseAgeWarning?: (message: string) => void;
}): Promise<AppRuntimeCommand> {
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  if (hasCustomCommands) {
    return {
      command: `${installCommand!.trim()} && ${startCommand!.trim()}`,
      isCustom: true,
      packageManager: null,
    };
  }

  return getDefaultCommand({
    runtimeMode,
    appId,
    appPath,
    onPnpmMinimumReleaseAgeWarning,
  });
}

function emitPnpmMinimumReleaseAgeWarning({
  appId,
  event,
  message,
}: {
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  message: string;
}) {
  const settings = readSettings();
  if (!shouldShowPnpmMinimumReleaseAgeWarning(settings)) {
    return;
  }

  safeSend(event.sender, "app:output", {
    type: "package-manager-warning",
    message,
    appId,
  });
}

export async function executeApp({
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
  const settings = readSettings();
  const runtimeMode = settings.runtimeMode2 ?? "host";

  notifyPnpmVersionMigrationAvailable({ appPath, appId, event });

  if (runtimeMode === "docker") {
    await executeAppInDocker({
      appPath,
      appId,
      event,
      isNeon,
      installCommand,
      startCommand,
    });
  } else if (runtimeMode === "cloud") {
    await executeAppInCloud({
      appPath,
      appId,
      event,
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

// Discovery nudge for the consented "Migrate to pnpm N" app upgrade: the
// contradiction (old pin/lockfile vs the managed pnpm) only bites outside
// Dyad (CI, deploys, teammates), so surface it in the console the user is
// already watching instead of failing or silently rewriting the pin.
function notifyPnpmVersionMigrationAvailable({
  appPath,
  appId,
  event,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
}): void {
  try {
    if (!isPnpmVersionMigrationNeeded(appPath)) {
      return;
    }
    const managedMajor = getManagedPnpmMajorVersion();
    safeSend(event.sender, "app:output", {
      type: "stdout",
      message: `[dyad] This project targets an older pnpm (pre-9 lockfile or pnpm <= 8 pin), but Dyad runs pnpm ${managedMajor} — deploys and CI that follow the project's pin can fail. Open App Details -> App Upgrades and apply "Migrate to pnpm ${managedMajor}".`,
      appId,
    });
  } catch (error) {
    logger.warn("Failed to check pnpm version migration status:", error);
  }
}

export function emitProxyServerStarted({
  appId,
  event,
  proxyUrl,
  originalUrl,
  mode,
}: {
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  proxyUrl: string;
  originalUrl: string;
  mode: RuntimeMode2;
}) {
  safeSend(event.sender, "app:output", {
    type: "stdout",
    message: `[dyad-proxy-server]started=[${proxyUrl}] original=[${originalUrl}] mode=[${mode}]`,
    appId,
  });
}

export async function ensureProxyForRunningApp({
  appId,
  event,
  originalUrl,
  mode,
}: {
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  originalUrl: string;
  mode: RuntimeMode2;
}): Promise<void> {
  const appInfo = runningApps.get(appId);
  if (!appInfo) {
    return;
  }

  const proxyAuthToken =
    mode === "cloud" ? appInfo.cloudPreviewAuthToken : undefined;

  if (
    appInfo.proxyWorker &&
    appInfo.originalUrl === originalUrl &&
    appInfo.proxyAuthToken === proxyAuthToken &&
    appInfo.proxyUrl
  ) {
    emitProxyServerStarted({
      appId,
      event,
      proxyUrl: appInfo.proxyUrl,
      originalUrl,
      mode,
    });
    return;
  }

  if (appInfo.proxyWorker) {
    await appInfo.proxyWorker.terminate();
    appInfo.proxyWorker = undefined;
  }

  // Prefer the deterministic port so the iframe origin stays stable across
  // restarts — otherwise origin-scoped browser state (auth sessions,
  // localStorage) gets orphaned and users appear logged out. If that port is
  // already taken (by a foreign service, or another Dyad app in the rare 10k
  // overlap), the proxy worker scans the fallback band upward rather than
  // killing whatever holds the port.
  const proxyPort = getAppProxyPort(appId);

  const proxyWorker = await startProxy(originalUrl, {
    port: proxyPort,
    onStarted: (proxyUrl) => {
      const latestAppInfo = runningApps.get(appId);
      if (latestAppInfo) {
        latestAppInfo.proxyUrl = proxyUrl;
        latestAppInfo.originalUrl = originalUrl;
        latestAppInfo.proxyAuthToken = proxyAuthToken;
      }
      emitProxyServerStarted({
        appId,
        event,
        proxyUrl,
        originalUrl,
        mode,
      });
    },
    onError: (error) => {
      logger.error(`Failed to start proxy for app ${appId}:`, error);
      safeSend(event.sender, "app:output", {
        type: "stderr",
        message: `[dyad-proxy-server] ${error.message}`,
        appId,
      });
    },
    fixedHeaders:
      mode === "cloud" && proxyAuthToken
        ? {
            Authorization: `Bearer ${proxyAuthToken}`,
          }
        : undefined,
  });

  const latestAppInfo = runningApps.get(appId);
  if (latestAppInfo) {
    latestAppInfo.proxyWorker = proxyWorker;
    latestAppInfo.originalUrl = originalUrl;
    latestAppInfo.proxyAuthToken = proxyAuthToken;
  } else {
    await proxyWorker.terminate();
  }
}

async function executeAppLocalNode({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
  ignoredBuildsSelfHealAttempted = false,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  ignoredBuildsSelfHealAttempted?: boolean;
}): Promise<void> {
  const command = await getCommand({
    runtimeMode: "host",
    appId,
    appPath,
    installCommand,
    startCommand,
    onPnpmMinimumReleaseAgeWarning: (message) =>
      emitPnpmMinimumReleaseAgeWarning({ appId, event, message }),
  });
  let env = { ...process.env };
  if (!command.isCustom && command.packageManager === "pnpm") {
    env = getPackageManagerCommandEnv();
  }

  const spawnedProcess = spawn(command.command, [], {
    cwd: appPath,
    env,
    shell: true,
    stdio: "pipe",
    detached: false,
  });

  if (!spawnedProcess.pid) {
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
    });

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
      `Failed to spawn process for app ${appId}. Command="${command.command}", CWD="${appPath}", ${details}\nSTDERR:\n${
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

  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process: spawnedProcess,
    processId: currentProcessId,
    mode: "host",
    rendererSender: event.sender,
    lastViewedAt: Date.now(),
  });

  listenToProcess({
    process: spawnedProcess,
    appId,
    appPath,
    isNeon,
    event,
    onPnpmIgnoredBuildsFailure:
      command.isCustom && !ignoredBuildsSelfHealAttempted
        ? async (output) => {
            const healed = await selfHealDeniedPnpmBuilds({
              appPath,
              output,
              telemetrySource: "self-heal",
            });
            if (!healed) {
              return false;
            }

            // Per "Transparent Over Magical": tell the user why the
            // process restarted instead of silently reinstalling.
            safeSend(event.sender, "app:output", {
              type: "stdout",
              message:
                "[dyad] pnpm blocked dependency build scripts. Recorded the decision in pnpm-workspace.yaml and reinstalling...",
              appId,
            });

            await executeAppLocalNode({
              appPath,
              appId,
              event,
              isNeon,
              installCommand,
              startCommand,
              ignoredBuildsSelfHealAttempted: true,
            });
            return true;
          }
        : undefined,
  });
}

const APP_OUTPUT_FLUSH_INTERVAL_MS = 100;

const pendingOutputs = new Map<Electron.WebContents, AppOutput[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueAppOutput(
  sender: Electron.WebContents,
  output: AppOutput,
): void {
  let queue = pendingOutputs.get(sender);
  if (!queue) {
    queue = [];
    pendingOutputs.set(sender, queue);
  }
  queue.push(output);

  if (!flushTimer) {
    flushTimer = setTimeout(flushAllAppOutputs, APP_OUTPUT_FLUSH_INTERVAL_MS);
  }
}

function flushAllAppOutputs(): void {
  flushTimer = null;
  for (const [sender, outputs] of pendingOutputs) {
    if (outputs.length > 0) {
      safeSend(sender, "app:output-batch", outputs);
    }
  }
  pendingOutputs.clear();
}

let cloudSandboxSyncUpdateListenerRegistered = false;

export function registerCloudSandboxSyncUpdateListener(): void {
  if (cloudSandboxSyncUpdateListenerRegistered) {
    return;
  }

  setCloudSandboxSyncUpdateListener(({ appId, errorMessage }) => {
    const appInfo = runningApps.get(appId);
    if (!appInfo || appInfo.mode !== "cloud") {
      return;
    }

    const previousErrorMessage = appInfo.cloudSyncErrorMessage ?? null;
    appInfo.cloudSyncErrorMessage = errorMessage ?? undefined;

    const sender = appInfo.rendererSender;
    if (!sender) {
      return;
    }

    if (errorMessage) {
      if (previousErrorMessage === errorMessage) {
        return;
      }

      addLog({
        level: "error",
        type: "server",
        message: errorMessage,
        timestamp: Date.now(),
        appId,
      });

      safeSend(sender, "app:output", {
        type: "sync-error",
        message: errorMessage,
        appId,
      });
      return;
    }

    if (!previousErrorMessage) {
      return;
    }

    const recoveredMessage =
      "Cloud sandbox sync recovered. Local changes are uploading again.";

    addLog({
      level: "info",
      type: "server",
      message: recoveredMessage,
      timestamp: Date.now(),
      appId,
    });

    safeSend(sender, "app:output", {
      type: "sync-recovered",
      message: recoveredMessage,
      appId,
    });
  });

  cloudSandboxSyncUpdateListenerRegistered = true;
}

// Records builds that a successful install skipped (the "Ignored build
// scripts" warning path) so the decision lands in pnpm-workspace.yaml and a
// later plain `pnpm install` (export/CI/Rebuild) cannot fail on
// ERR_PNPM_IGNORED_BUILDS. Best-effort: reads [] when .modules.yaml is
// absent (npm apps, Docker-volume installs).
async function recordIgnoredBuildsAfterInstall(appPath: string): Promise<void> {
  try {
    const ignoredBuilds = await resolvePnpmIgnoredBuilds(appPath);
    await recordAndReportDeniedPnpmBuilds({
      appPath,
      ignoredBuilds,
      source: "app-run",
    });
  } catch (error) {
    logger.warn("Failed to record ignored pnpm builds after install:", error);
  }
}

function listenToProcess({
  process: spawnedProcess,
  appId,
  appPath,
  isNeon,
  event,
  onPnpmIgnoredBuildsFailure,
}: {
  process: ChildProcess;
  appId: number;
  appPath?: string;
  isNeon: boolean;
  event: Electron.IpcMainInvokeEvent;
  onPnpmIgnoredBuildsFailure?: (output: string) => Promise<boolean>;
}) {
  // Rolling tail, kept only while a self-heal callback could still use it:
  // dev servers run for hours and unbounded accumulation would leak memory.
  // The ERR_PNPM_IGNORED_BUILDS marker appears at the end of a failed
  // install, so a bounded tail is sufficient for the close-handler check.
  const MAX_PROCESS_OUTPUT_TAIL_LENGTH = 64 * 1024;
  let processOutput = "";
  let ignoredBuildsRecordedAfterInstall = false;
  const appendProcessOutput = (message: string) => {
    if (!onPnpmIgnoredBuildsFailure) {
      return;
    }
    processOutput = (processOutput + message).slice(
      -MAX_PROCESS_OUTPUT_TAIL_LENGTH,
    );
  };
  spawnedProcess.stdout?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    appendProcessOutput(message);
    logger.debug(
      `App ${appId} (PID: ${spawnedProcess.pid}) stdout: ${message}`,
    );

    addLog({
      level: "info",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    if (isNeon && message.includes("created or renamed from another")) {
      spawnedProcess.stdin?.write(`\r\n`);
      logger.info(
        `App ${appId} (PID: ${spawnedProcess.pid}) wrote enter to stdin to automatically respond to drizzle push input`,
      );
    }

    const inputRequestPattern = /\s*›\s*\([yY]\/[nN]\)\s*$/;
    const isInputRequest = inputRequestPattern.test(message);
    if (isInputRequest) {
      safeSend(event.sender, "app:output", {
        type: "input-requested",
        message,
        appId,
      });
    } else {
      enqueueAppOutput(event.sender, {
        type: "stdout",
        message,
        appId,
      });

      const urlMatch = message.match(/(https?:\/\/localhost:\d+\/?)/);
      if (urlMatch) {
        const originalUrl = urlMatch[1];
        // The dev-server URL appearing means the install phase completed
        // successfully — the one point in the `install && dev` chain where
        // ignored builds can be read and recorded.
        if (appPath && !ignoredBuildsRecordedAfterInstall) {
          ignoredBuildsRecordedAfterInstall = true;
          void recordIgnoredBuildsAfterInstall(appPath);
        }
        await ensureProxyForRunningApp({
          appId,
          event,
          originalUrl,
          mode: "host",
        });
      }
    }
  });

  spawnedProcess.stderr?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    appendProcessOutput(message);
    logger.error(
      `App ${appId} (PID: ${spawnedProcess.pid}) stderr: ${message}`,
    );

    addLog({
      level: "error",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    enqueueAppOutput(event.sender, {
      type: "stderr",
      message,
      appId,
    });
  });

  spawnedProcess.on("close", (code, signal) => {
    void (async () => {
      try {
        logger.log(
          `App ${appId} (PID: ${spawnedProcess.pid}) process closed with code ${code}, signal ${signal}.`,
        );
        flushAllAppOutputs();
        const currentAppInfo = runningApps.get(appId);
        if (!currentAppInfo || currentAppInfo.process !== spawnedProcess) {
          removeAppIfCurrentProcess(appId, spawnedProcess);
          return;
        }

        if (
          code !== 0 &&
          onPnpmIgnoredBuildsFailure &&
          isPnpmIgnoredBuildsError(processOutput)
        ) {
          let retried = false;
          try {
            retried = await onPnpmIgnoredBuildsFailure(processOutput);
          } catch (error) {
            logger.warn(
              `Failed to self-heal pnpm ignored builds for app ${appId}:`,
              error,
            );
          }
          if (retried) {
            return;
          }
        }

        safeSend(event.sender, "app:output", {
          type: "app-exit",
          message: `App process exited with code ${code ?? "null"}`,
          appId,
          exitCode: code,
          signal,
          timestamp: Date.now(),
        });
        removeAppIfCurrentProcess(appId, spawnedProcess);
      } catch (error) {
        // The close handler is a critical lifecycle point; never let an
        // unexpected error leave a stale runningApps entry behind.
        logger.error(
          `Unexpected error in close handler for app ${appId}:`,
          error,
        );
        removeAppIfCurrentProcess(appId, spawnedProcess);
      }
    })();
  });

  spawnedProcess.on("error", (err) => {
    logger.error(
      `Error in app ${appId} (PID: ${spawnedProcess.pid}) process: ${err.message}`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
  });
}

async function selfHealDeniedPnpmBuilds({
  appPath,
  output,
  telemetrySource,
  removeNodeModules = true,
}: {
  appPath: string;
  output: string;
  telemetrySource: "self-heal";
  // Docker installs use the container volume, not host node_modules, and an
  // explicit `pkg: false` entry passes even a fast-path install — so the
  // Docker caller skips the host cleanup.
  removeNodeModules?: boolean;
}): Promise<boolean> {
  const ignoredBuilds = await resolvePnpmIgnoredBuilds(appPath, output);
  // recordDeniedPnpmBuilds may also promote previously auto-denied packages
  // as a side effect; no explicit `pnpm rebuild` is needed here because
  // node_modules is removed below, so the retry's fresh install runs build
  // scripts for newly-allowed packages natively.
  const { deniedBuilds } = await recordAndReportDeniedPnpmBuilds({
    appPath,
    ignoredBuilds,
    source: telemetrySource,
  });
  if (deniedBuilds.length === 0) {
    return false;
  }

  if (removeNodeModules) {
    await fs.promises.rm(path.join(appPath, "node_modules"), {
      recursive: true,
      force: true,
    });
  }

  return true;
}

async function executeAppInDocker({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
  ignoredBuildsSelfHealAttempted = false,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  ignoredBuildsSelfHealAttempted?: boolean;
}): Promise<void> {
  const containerName = `dyad-app-${appId}`;

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
        removeContainer.on("error", () => resolve());
      });
      stopContainer.on("error", () => resolve());
    });
  } catch (error) {
    logger.info(
      `Docker container ${containerName} not found. Ignoring error: ${error}`,
    );
  }

  const dockerfilePath = path.join(appPath, "Dockerfile.dyad");
  if (!fs.existsSync(dockerfilePath)) {
    const dockerfileContent = `FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm
`;

    try {
      await fs.promises.writeFile(dockerfilePath, dockerfileContent, "utf-8");
    } catch (error) {
      logger.error(`Failed to create Dockerfile for app ${appId}:`, error);
      throw new DyadError(
        `Failed to create Dockerfile: ${error}`,
        DyadErrorKind.External,
      );
    }
  }

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
      (
        await getCommand({
          runtimeMode: "docker",
          appId,
          appPath,
          installCommand,
          startCommand,
          onPnpmMinimumReleaseAgeWarning: (message) =>
            emitPnpmMinimumReleaseAgeWarning({ appId, event, message }),
        })
      ).command,
    ],
    {
      stdio: "pipe",
      detached: false,
    },
  );

  if (!process.pid) {
    let errorOutput = "";
    let spawnErr: any = null;
    process.stderr?.on("data", (data) => (errorOutput += data.toString()));
    await new Promise<void>((resolve) => {
      process.once("error", (err) => {
        spawnErr = err;
        resolve();
      });
    });

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

  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process,
    processId: currentProcessId,
    mode: "docker",
    rendererSender: event.sender,
    containerName,
    lastViewedAt: Date.now(),
  });

  // Mirrors the host path: custom `install && start` chains run strict pnpm
  // inside the container, so an ERR_PNPM_IGNORED_BUILDS exit needs the same
  // record-denials-and-retry treatment (executeAppInDocker is restart-safe —
  // it stops and removes the previous container first).
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  listenToProcess({
    process,
    appId,
    appPath,
    isNeon,
    event,
    onPnpmIgnoredBuildsFailure:
      hasCustomCommands && !ignoredBuildsSelfHealAttempted
        ? async (output) => {
            const healed = await selfHealDeniedPnpmBuilds({
              appPath,
              output,
              telemetrySource: "self-heal",
              removeNodeModules: false,
            });
            if (!healed) {
              return false;
            }

            safeSend(event.sender, "app:output", {
              type: "stdout",
              message:
                "[dyad] pnpm blocked dependency build scripts. Recorded the decision in pnpm-workspace.yaml and reinstalling...",
              appId,
            });

            await executeAppInDocker({
              appPath,
              appId,
              event,
              isNeon,
              installCommand,
              startCommand,
              ignoredBuildsSelfHealAttempted: true,
            });
            return true;
          }
        : undefined,
  });
}

async function executeAppInCloud({
  appPath,
  appId,
  event,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  const currentProcessId = processCounter.increment();
  let sandboxId: string | undefined;
  let previewUrl: string | undefined;
  let previewAuthToken: string | undefined;

  try {
    const createResult = await createCloudSandbox({
      appId,
      appPath,
      installCommand,
      startCommand,
    });
    sandboxId = createResult.sandboxId;
    previewUrl = createResult.previewUrl;
    previewAuthToken = createResult.previewAuthToken;

    const files = await buildCloudSandboxFileMap(appPath);
    const uploadResult = await uploadCloudSandboxFiles({
      sandboxId,
      files,
      replaceAll: true,
    });
    previewUrl = uploadResult.previewUrl ?? previewUrl;
    previewAuthToken = uploadResult.previewAuthToken ?? previewAuthToken;
  } catch (error) {
    if (sandboxId) {
      try {
        await destroyCloudSandbox(sandboxId);
      } catch (cleanupError) {
        logger.warn(
          `Failed to clean up cloud sandbox ${sandboxId} after startup error for app ${appId}:`,
          cleanupError,
        );
      }
    }
    throw new Error(formatCloudSandboxError(error));
  }

  const resolvedPreviewUrl = previewUrl;
  const resolvedPreviewAuthToken = previewAuthToken;
  if (!sandboxId || !resolvedPreviewUrl || !resolvedPreviewAuthToken) {
    throw new Error(
      "Cloud sandbox startup returned incomplete preview credentials.",
    );
  }

  const cloudLogAbortController = new AbortController();
  runningApps.set(appId, {
    process: null,
    processId: currentProcessId,
    mode: "cloud",
    rendererSender: event.sender,
    cloudSandboxId: sandboxId,
    cloudPreviewUrl: resolvedPreviewUrl,
    cloudPreviewAuthToken: resolvedPreviewAuthToken,
    cloudLogAbortController,
    lastViewedAt: Date.now(),
    originalUrl: resolvedPreviewUrl,
  });
  registerRunningCloudSandbox({
    appId,
    appPath,
    sandboxId,
  });

  await ensureProxyForRunningApp({
    appId,
    event,
    originalUrl: resolvedPreviewUrl,
    mode: "cloud",
  });

  startCloudSandboxLogStream({
    appId,
    appPath,
    event,
    sandboxId,
    cloudLogAbortController,
  });
}

export function startCloudSandboxLogStream(input: {
  appId: number;
  appPath?: string;
  event: Electron.IpcMainInvokeEvent;
  sandboxId: string;
  cloudLogAbortController: AbortController;
}) {
  // The sandbox install runs remotely and node_modules is never synced back,
  // so the only way to observe ignored builds is the "Ignored build scripts"
  // line in the streamed install output. Keep a bounded tail across chunks
  // (the line may be split) and record denials locally once, best-effort.
  const MAX_LOG_TAIL_LENGTH = 16 * 1024;
  let logTail = "";
  let ignoredBuildsRecorded = false;
  const maybeRecordIgnoredBuilds = (message: string) => {
    if (!input.appPath || ignoredBuildsRecorded) {
      return;
    }
    logTail = (logTail + message).slice(-MAX_LOG_TAIL_LENGTH);
    const ignoredBuilds = parsePnpmIgnoredBuildsFromOutput(logTail);
    if (ignoredBuilds.length === 0) {
      return;
    }
    ignoredBuildsRecorded = true;
    const appPath = input.appPath;
    void (async () => {
      try {
        // Output-only on purpose: the install ran remotely, so the local
        // .modules.yaml (if any) does not describe this sandbox.
        await recordAndReportDeniedPnpmBuilds({
          appPath,
          ignoredBuilds,
          source: "cloud-sandbox",
        });
      } catch (error) {
        logger.warn(
          "Failed to record ignored pnpm builds from cloud sandbox logs:",
          error,
        );
      }
    })();
  };

  void (async () => {
    try {
      for await (const message of streamCloudSandboxLogs(
        input.sandboxId,
        input.cloudLogAbortController.signal,
      )) {
        const appInfo = runningApps.get(input.appId);
        if (!appInfo || appInfo.cloudSandboxId !== input.sandboxId) {
          return;
        }

        maybeRecordIgnoredBuilds(message);

        addLog({
          level: "info",
          type: "server",
          message,
          timestamp: Date.now(),
          appId: input.appId,
        });

        safeSend(input.event.sender, "app:output", {
          type: "stdout",
          message,
          appId: input.appId,
        });
      }
    } catch (error) {
      if (input.cloudLogAbortController.signal.aborted) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : `Cloud sandbox log stream failed: ${String(error)}`;

      addLog({
        level: "error",
        type: "server",
        message,
        timestamp: Date.now(),
        appId: input.appId,
      });

      safeSend(input.event.sender, "app:output", {
        type: "stderr",
        message,
        appId: input.appId,
      });
    }
  })();
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPort(port, "tcp");
  } catch {
    // Ignore if nothing was running on that port.
  }
}

async function stopDockerContainersOnPort(port: number): Promise<void> {
  try {
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

export async function cleanUpPort(port: number) {
  const settings = readSettings();
  if (settings.runtimeMode2 === "docker") {
    await stopDockerContainersOnPort(port);
  } else {
    await killProcessOnPort(port);
  }
}
