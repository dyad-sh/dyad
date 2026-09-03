import { ChildProcess, spawn } from "node:child_process";
import treeKill from "tree-kill";
import log from "electron-log";
import type { Worker } from "node:worker_threads";
import type { RuntimeMode2 } from "@/lib/schemas";
import { appOperationCoordinator } from "../services/app_operation_coordinator";
import {
  destroyCloudSandbox,
  stopCloudSandboxFileSync,
  unregisterRunningCloudSandbox,
} from "./cloud_sandbox_provider";
import { readSettings } from "../../main/settings";
import { endRecordingForApp } from "../services/recording_registry";
import type { AppRunInvocationRef } from "@/app_run/state";
import type { AppRuntimeOutput } from "@/ipc/types/app_runtime";
import { killProcessTreeSync } from "./kill_process_tree_sync";

const logger = log.scope("process_manager");

// Define a type for the value stored in runningApps
export interface RunningAppInfo {
  process: ChildProcess | null;
  processId: number;
  /** Correlation identity of the run/restart that owns this producer. */
  invocationRef?: AppRunInvocationRef;
  mode: RuntimeMode2;
  /** Output producer captured when this runtime invocation is created. */
  output?: AppRuntimeOutput;
  containerName?: string;
  cloudSandboxId?: string;
  cloudPreviewUrl?: string;
  cloudPreviewAuthToken?: string;
  proxyAuthToken?: string;
  cloudSyncErrorMessage?: string;
  cloudLogAbortController?: AbortController;
  /** Timestamp of when this app was last viewed/selected in the preview panel */
  lastViewedAt: number;
  /** Proxy URL for the running app, set when the proxy server starts */
  proxyUrl?: string;
  /**
   * Capability embedded in proxied HTML and returned only to the trusted
   * renderer. Auth bootstrap messages must echo it before the preview will
   * accept credentials from its framing parent.
   */
  authBootstrapToken?: string;
  /** Original localhost URL for the running app */
  originalUrl?: string;
  /** Proxy worker dedicated to this running app */
  proxyWorker?: Worker;
  /**
   * Set while a recording's own lifecycle is replacing this process.
   *
   * The child's `close` listener runs to completion before `stopAppByInfo`
   * resumes past its kill and removes the map entry, so an intentional
   * replacement is indistinguishable from a crash at that point. Isolation
   * setup restarts the very app it is preparing to record; without this marker
   * that restart reports itself as `app-stopped` and cancels the session it
   * belongs to.
   */
  recordingOwnedRestart?: boolean;
}

// Store running app processes
export const runningApps = new Map<number, RunningAppInfo>();
// Global counter for process IDs
let processCounterValue = 0;

// Getter and setter for processCounter to allow modification from outside
export const processCounter = {
  get value(): number {
    return processCounterValue;
  },
  set value(newValue: number) {
    processCounterValue = newValue;
  },
  increment(): number {
    return ++processCounterValue;
  },
};

/**
 * Returns [appId, pid] pairs for apps with a locally spawned process.
 * Read-only accessor used by memory diagnostics; excludes cloud/docker apps,
 * which have no local child process to inspect.
 */
export function getRunningAppProcessPids(): { appId: number; pid: number }[] {
  const pairs: { appId: number; pid: number }[] = [];
  for (const [appId, appInfo] of runningApps.entries()) {
    if (appInfo.mode !== "host") {
      continue;
    }
    const pid = appInfo.process?.pid;
    if (typeof pid === "number") {
      pairs.push({ appId, pid });
    }
  }
  return pairs;
}

/**
 * Kills a running process with its child processes
 * @param process The child process to kill
 * @param pid The process ID
 * @returns A promise that resolves when the process is closed or timeout
 */
export function killProcess(process: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      logger.warn(
        `Timeout waiting for process (PID: ${process.pid}) to close. Force killing may be needed.`,
      );
      resolve();
    }, 5000); // 5-second timeout

    process.on("close", (code, signal) => {
      clearTimeout(timeout);
      logger.info(
        `Received 'close' event for process (PID: ${process.pid}) with code ${code}, signal ${signal}.`,
      );
      resolve();
    });

    // Handle potential errors during kill/close sequence
    process.on("error", (err) => {
      clearTimeout(timeout);
      logger.error(
        `Error during stop sequence for process (PID: ${process.pid}): ${err.message}`,
      );
      resolve();
    });

    // Ensure PID exists before attempting to kill
    if (process.pid) {
      // Use tree-kill to terminate the entire process tree
      logger.info(
        `Attempting to tree-kill process tree starting at PID ${process.pid}.`,
      );
      treeKill(process.pid, "SIGTERM", (err: Error | undefined) => {
        if (err) {
          logger.warn(`tree-kill error for PID ${process.pid}: ${err.message}`);
        } else {
          logger.info(
            `tree-kill signal sent successfully to PID ${process.pid}.`,
          );
        }
      });
    } else {
      logger.warn(`Cannot tree-kill process: PID is undefined.`);
    }
  });
}

/**
 * Escalate to SIGKILL for a tree that outlived `killProcess`'s SIGTERM window,
 * and wait (bounded) for it to actually close.
 *
 * `killProcess` resolves on its own 5s timeout with the tree still alive, which
 * is fine for a caller that only needs the port back. It is not fine for one
 * that is about to delete the directory the tree is running in: a survivor
 * keeps serving, and on Windows keeps the directory locked.
 *
 * Resolves to whether the tree is CONFIRMED closed, which is narrower than
 * "the signal was sent". Confirmation comes from the root's `close` event, so
 * a root that had already exited resolves `false` — its descendants may have
 * been reparented beyond anything this pid can reach or observe. A caller that
 * needs certainty in that case must check something a survivor would still be
 * holding, such as the port it was serving on.
 */
export function forceKillProcessTree(
  process: ChildProcess,
  timeoutMs = 5000,
): Promise<boolean> {
  const pid = process.pid;
  if (!pid) {
    return Promise.resolve(false);
  }
  // Deliberately NOT short-circuited on the root having exited. The E2E runtime
  // spawns a shell, and a shell that has exited says nothing about the dev
  // server it started: `npm run dev` forks a child that routinely outlives its
  // parent. Reporting "closed" from the root's exit code alone would skip the
  // SIGKILL for exactly the survivor that still holds the sandbox directory.
  // `tree-kill` walks the tree from this pid, and a pid whose whole tree is
  // already gone makes it a no-op that resolves on the timeout below.
  const rootAlreadyExited =
    process.exitCode !== null || process.signalCode !== null;
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn(
        `Process tree (PID: ${pid}) survived SIGKILL within ${timeoutMs}ms.`,
      );
      resolve(false);
    }, timeoutMs);
    const settle = (closed: boolean) => {
      clearTimeout(timeout);
      resolve(closed);
    };
    if (!rootAlreadyExited) {
      // `close` fires after the root's stdio has drained, which is the closest
      // signal Node gives that its descendants sharing those pipes are gone.
      process.once("close", () => settle(true));
      process.once("error", () => settle(false));
    }
    logger.info(`Escalating to SIGKILL for process tree at PID ${pid}.`);
    treeKill(pid, "SIGKILL", (err: Error | undefined) => {
      if (err) {
        logger.warn(`tree-kill SIGKILL error for PID ${pid}: ${err.message}`);
      }
      // An exited root has already emitted its `close`, so there is nothing
      // left here to observe — and a descendant that daemonized or was
      // reparented is no longer reachable from this pid at all, so tree-kill's
      // own success says nothing about it either. Report "not confirmed" rather
      // than waiting out the timeout for an event that cannot arrive; a caller
      // that needs certainty has to check something the survivor would still be
      // holding.
      if (rootAlreadyExited) settle(false);
    });
  });
}

/**
 * Gracefully stops a Docker container by name. Resolves even if the container doesn't exist.
 */
export function stopDockerContainer(containerName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = spawn("docker", ["stop", containerName], { stdio: "pipe" });
    stop.on("close", () => resolve());
    stop.on("error", () => resolve());
  });
}

/**
 * Removes Docker named volumes used for an app's dependencies.
 * Best-effort: resolves even if volumes don't exist.
 */
export function removeDockerVolumesForApp(appId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const pnpmVolume = `dyad-pnpm-${appId}`;

    const rm = spawn("docker", ["volume", "rm", "-f", pnpmVolume], {
      stdio: "pipe",
    });
    rm.on("close", () => resolve());
    rm.on("error", () => resolve());
  });
}

/**
 * Stops an app based on its RunningAppInfo (container vs host) and removes it from the running map.
 *
 * Pass `recordingOwnedRestart` when the stop is part of a recording's own
 * lifecycle (isolation setup and teardown restart the app they are recording).
 * The process's `close` listener sees the map entry as still current, so
 * otherwise the restart would be read as the app going away and end the session
 * it is preparing.
 */
export async function stopAppByInfo(
  appId: number,
  appInfo: RunningAppInfo,
  options: { recordingOwnedRestart?: boolean } = {},
): Promise<void> {
  if (options.recordingOwnedRestart) {
    appInfo.recordingOwnedRestart = true;
  }
  try {
    stopCloudSandboxFileSync(appId);

    if (appInfo.mode === "cloud") {
      if (appInfo.cloudSandboxId) {
        await destroyCloudSandbox(appInfo.cloudSandboxId);
      }
    } else if (appInfo.mode === "docker") {
      const containerName = appInfo.containerName || `dyad-app-${appId}`;
      await stopDockerContainer(containerName);
    } else if (appInfo.process) {
      await killProcess(appInfo.process);
    }

    if (appInfo.proxyWorker) {
      await appInfo.proxyWorker.terminate();
      appInfo.proxyWorker = undefined;
    }

    appInfo.cloudLogAbortController?.abort();
    appInfo.cloudLogAbortController = undefined;
    unregisterRunningCloudSandbox({ appId });
    runningApps.delete(appId);
  } finally {
    // The marker only has to outlive the kill, whose `close` listener runs
    // inside the await above. Left latched on a stop that threw, it would sit
    // on an entry still in `runningApps` and suppress a later, legitimate
    // `app-stopped` — holding the session's claim until the 30-minute cap with
    // no preview left to record.
    appInfo.recordingOwnedRestart = false;
  }
}

/**
 * Removes an app from the running apps map if it's the current process
 * @param appId The app ID
 * @param process The process to check against
 */
export function removeAppIfCurrentProcess(
  appId: number,
  process: ChildProcess,
): void {
  const currentAppInfo = runningApps.get(appId);
  if (currentAppInfo && currentAppInfo.process === process) {
    if (currentAppInfo.proxyWorker) {
      void currentAppInfo.proxyWorker.terminate();
      currentAppInfo.proxyWorker = undefined;
    }
    currentAppInfo.cloudLogAbortController?.abort();
    currentAppInfo.cloudLogAbortController = undefined;
    stopCloudSandboxFileSync(appId);
    unregisterRunningCloudSandbox({ appId });
    runningApps.delete(appId);
    logger.info(
      `Removed app ${appId} (processId ${currentAppInfo.processId}) from running map. Current size: ${runningApps.size}`,
    );
    // The dev server went away on its own — a crash, or the user killing it
    // outside Dyad. Stop/Restart/Delete end a recording explicitly, but this
    // path had nothing watching it, so isolation and the session's whole-app
    // claim would have been held until the 30-minute cap with no preview left
    // to record.
    //
    // A recording's own restart is the one deliberate stop that does reach
    // here: `stopAppByInfo` only deletes the map entry after the kill resolves,
    // and this listener runs first, so isolation setup would otherwise cancel
    // the session it is preparing. That caller marks its entry instead.
    //
    // `skipRestart` because there is no process to put back — teardown must
    // restore `.env.local`, not resurrect an app the user didn't ask to start.
    // Fire-and-forget: this is a lifecycle callback, and teardown reports its
    // own failures to the recorder bar.
    if (!currentAppInfo.recordingOwnedRestart) {
      void endRecordingForApp(appId, "app-stopped", {
        skipRestart: true,
      }).catch((error) => {
        logger.error(
          `Failed to end app ${appId}'s recording after its process exited: ${error}`,
        );
      });
    }
  } else {
    logger.info(
      `App ${appId} process was already removed or replaced in running map. Ignoring.`,
    );
  }
}

/**
 * Updates the lastViewedAt timestamp for an app.
 * This is called when a user views/selects an app in the preview panel.
 * @param appId The app ID to update
 */
export function updateAppLastViewed(appId: number): void {
  const appInfo = runningApps.get(appId);
  if (appInfo) {
    appInfo.lastViewedAt = Date.now();
    logger.info(`Updated lastViewedAt for app ${appId}`);
  }
}

// Garbage collection interval in milliseconds (check every 1 minute)
const GC_CHECK_INTERVAL_MS = 60 * 1000;
// Time in milliseconds after which an idle app is eligible for garbage collection (10 minutes)
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// Track the currently selected app ID to avoid garbage collecting it
let currentlySelectedAppId: number | null = null;

/**
 * Sets the currently selected app ID. The selected app will never be garbage collected.
 * @param appId The app ID that is currently selected, or null if none
 */
export function setCurrentlySelectedAppId(appId: number | null): void {
  // Update lastViewedAt for the previously selected app so the idle timer
  // starts from when the user actually stopped viewing it
  if (currentlySelectedAppId !== null && currentlySelectedAppId !== appId) {
    updateAppLastViewed(currentlySelectedAppId);
  }
  currentlySelectedAppId = appId;
  if (appId !== null) {
    updateAppLastViewed(appId);
  }
}

/**
 * Gets the currently selected app ID.
 */
export function getCurrentlySelectedAppId(): number | null {
  return currentlySelectedAppId;
}

/**
 * Garbage collects idle apps that haven't been viewed in the last 10 minutes
 * and are not the currently selected app.
 */
export async function garbageCollectIdleApps(): Promise<void> {
  if (readSettings().previewIdleTimeoutPolicy === "never") {
    return;
  }

  const now = Date.now();
  const appsToStop: number[] = [];

  for (const [appId, appInfo] of runningApps.entries()) {
    // Never garbage collect the currently selected app
    if (appId === currentlySelectedAppId) {
      continue;
    }

    // Check if the app has been idle for more than 10 minutes
    const idleTime = now - appInfo.lastViewedAt;
    if (idleTime >= IDLE_TIMEOUT_MS) {
      logger.info(
        `App ${appId} has been idle for ${Math.round(idleTime / 1000 / 60)} minutes. Marking for garbage collection.`,
      );
      appsToStop.push(appId);
    }
  }

  // Stop idle apps (acquire per-app lock to avoid racing with runApp/stopApp/restartApp)
  for (const appId of appsToStop) {
    try {
      await appOperationCoordinator.run(
        {
          appId,
          operation: "garbage-collect-app-runtime",
          resources: ["runtime"],
        },
        async () => {
          // Re-check: the user may have selected this app while we were stopping others
          if (appId === currentlySelectedAppId) {
            logger.info(
              `Skipping GC for app ${appId}: it became the selected app during this GC cycle`,
            );
            return;
          }
          const appInfo = runningApps.get(appId);
          if (!appInfo) return;
          // Re-check idle time under lock in case the app was viewed/restarted
          const recheckIdle = Date.now() - appInfo.lastViewedAt;
          if (recheckIdle < IDLE_TIMEOUT_MS) {
            logger.info(
              `Skipping GC for app ${appId}: idle time refreshed during lock wait`,
            );
            return;
          }
          logger.info(`Garbage collecting idle app ${appId}`);
          await stopAppByInfo(appId, appInfo);
        },
      );
    } catch (error) {
      logger.error(`Failed to garbage collect app ${appId}:`, error);
    }
  }

  if (appsToStop.length > 0) {
    logger.info(
      `Garbage collection complete. Stopped ${appsToStop.length} idle app(s). Running apps: ${runningApps.size}`,
    );
  }
}

// Start the garbage collection timer
let gcTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts the garbage collection timer to periodically clean up idle apps.
 * Uses recursive setTimeout instead of setInterval to prevent overlapping
 * executions when garbageCollectIdleApps takes longer than the interval.
 */
export function startAppGarbageCollection(): void {
  if (gcTimeoutId !== null) {
    logger.info("App garbage collection already running");
    return;
  }

  logger.info(
    `Starting app garbage collection (interval: ${GC_CHECK_INTERVAL_MS / 1000}s, idle timeout: ${IDLE_TIMEOUT_MS / 1000 / 60} minutes)`,
  );

  const runGarbageCollection = () => {
    garbageCollectIdleApps()
      .catch((error) => {
        logger.error("Error during app garbage collection:", error);
      })
      .finally(() => {
        // Only schedule next run if not stopped
        if (gcTimeoutId !== null) {
          gcTimeoutId = setTimeout(runGarbageCollection, GC_CHECK_INTERVAL_MS);
        }
      });
  };

  gcTimeoutId = setTimeout(runGarbageCollection, GC_CHECK_INTERVAL_MS);
}

/**
 * Stops the garbage collection timer.
 */
export function stopAppGarbageCollection(): void {
  if (gcTimeoutId !== null) {
    clearTimeout(gcTimeoutId);
    gcTimeoutId = null;
    logger.info("Stopped app garbage collection");
  }
}

/**
 * Synchronously sends kill signals to all running apps without awaiting completion.
 * Used during app quit when Electron's EventEmitter does not await async handlers.
 */
export function stopAllAppsSync(): void {
  const appIds = Array.from(runningApps.keys());
  logger.info(`Synchronously stopping ${appIds.length} running app(s) on quit`);

  for (const appId of appIds) {
    const appInfo = runningApps.get(appId);
    if (!appInfo) continue;

    if (appInfo.proxyWorker) {
      void appInfo.proxyWorker.terminate();
      appInfo.proxyWorker = undefined;
    }

    if (appInfo.mode === "cloud") {
      appInfo.cloudLogAbortController?.abort();
      appInfo.cloudLogAbortController = undefined;
      stopCloudSandboxFileSync(appId);
      unregisterRunningCloudSandbox({ appId });
      if (appInfo.cloudSandboxId) {
        void destroyCloudSandbox(appInfo.cloudSandboxId).catch((error) => {
          logger.warn(
            `Failed to destroy cloud sandbox ${appInfo.cloudSandboxId} for app ${appId} during quit: ${error}`,
          );
        });
      }
      logger.info(
        `Cloud sandbox ${appInfo.cloudSandboxId ?? "<unknown>"} for app ${appId} will be reconciled asynchronously after quit if needed.`,
      );
    } else if (appInfo.mode === "docker") {
      const containerName = appInfo.containerName || `dyad-app-${appId}`;
      // Fire-and-forget: spawn docker stop without awaiting
      const stop = spawn("docker", ["stop", containerName], {
        stdio: "ignore",
      });
      stop.on("error", (err) => {
        logger.warn(
          `Failed to stop docker container for app ${appId} (${containerName}): ${err.message}`,
        );
      });
      logger.info(`Sent docker stop for app ${appId} (${containerName})`);
    } else if (appInfo.process?.pid) {
      const pid = appInfo.process.pid;
      if (killProcessTreeSync(pid)) {
        logger.info(`Sent SIGTERM to app ${appId} (PID ${pid})`);
      } else {
        logger.warn(
          `Failed to synchronously terminate app ${appId} (PID ${pid}) during quit`,
        );
        continue;
      }
    }
    runningApps.delete(appId);
  }
}
