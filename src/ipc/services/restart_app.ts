import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { clearLogs } from "@/lib/log_store";
import { getDyadAppPath } from "@/paths/paths";
import { getAppPort } from "../../../shared/ports";
import {
  cleanUpPort,
  ensureProxyForRunningApp,
  executeApp,
  startCloudSandboxLogStream,
} from "./app_runtime_service";
import { restartCloudSandbox } from "../utils/cloud_sandbox_provider";
import { withLock } from "../utils/lock_utils";
import {
  removeDockerVolumesForApp,
  runningApps,
  stopAppByInfo,
} from "../utils/process_manager";
import type { AppRunInvocationRef } from "@/app_run/state";

const logger = log.scope("restart_app");

export interface RestartAppOptions {
  appId: number;
  invocationRef?: AppRunInvocationRef;
  removeNodeModules?: boolean;
  recreateSandbox?: boolean;
  clearRuntimeLogs?: boolean;
}

/**
 * Restart an app through the same main-process lifecycle used by the preview
 * controls. Keeping this operation outside the IPC registration lets internal
 * callers such as Local Agent tools share the locking and runtime behavior.
 */
export async function restartApp(
  event: IpcMainInvokeEvent,
  {
    appId,
    invocationRef,
    removeNodeModules = false,
    recreateSandbox = false,
    clearRuntimeLogs = false,
  }: RestartAppOptions,
): Promise<void> {
  logger.log(`Restarting app ${appId}`);
  return withLock(appId, async () => {
    try {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      const appPath = getDyadAppPath(app.path);

      const appInfo = runningApps.get(appId);
      if (
        appInfo &&
        appInfo.mode === "cloud" &&
        appInfo.cloudSandboxId &&
        !recreateSandbox
      ) {
        logger.log(`Restarting cloud sandbox app ${appId} in place`);

        appInfo.cloudLogAbortController?.abort();
        const restartResult = await restartCloudSandbox(appInfo.cloudSandboxId);
        appInfo.cloudPreviewUrl = restartResult.previewUrl;
        appInfo.cloudPreviewAuthToken = restartResult.previewAuthToken;
        appInfo.lastViewedAt = Date.now();
        appInfo.invocationRef = invocationRef;

        appInfo.cloudLogAbortController = new AbortController();

        if (clearRuntimeLogs) {
          clearLogs(appId);
        }

        await ensureProxyForRunningApp({
          appId,
          event,
          originalUrl: restartResult.previewUrl,
          mode: "cloud",
          invocationRef,
        });

        startCloudSandboxLogStream({
          appId,
          appPath,
          event,
          sandboxId: appInfo.cloudSandboxId,
          cloudLogAbortController: appInfo.cloudLogAbortController,
        });
        return;
      }

      if (appInfo) {
        const { processId } = appInfo;
        logger.log(
          `Stopping app ${appId} (processId ${processId}) before restart`,
        );
        await stopAppByInfo(appId, appInfo);
      } else {
        logger.log(`App ${appId} not running. Proceeding to start.`);
      }

      // A previous run may have left a process on this port.
      await cleanUpPort(getAppPort(appId));

      if (removeNodeModules) {
        const settings = readSettings();
        const runtimeMode = settings.runtimeMode2 ?? "host";
        const nodeModulesPath = path.join(appPath, "node_modules");

        logger.log(
          `Removing node_modules for app ${appId} at ${nodeModulesPath}`,
        );
        await fsPromises.rm(nodeModulesPath, {
          recursive: true,
          force: true,
        });
        logger.log(`Removed node_modules for app ${appId}, if present`);

        if (runtimeMode === "docker") {
          logger.log(
            `Docker mode detected for app ${appId}. Removing Docker volumes dyad-pnpm-${appId}...`,
          );
          try {
            await removeDockerVolumesForApp(appId);
            logger.log(
              `Removed Docker volumes for app ${appId} (dyad-pnpm-${appId}).`,
            );
          } catch (error) {
            // Best-effort cleanup; the fresh app start can still succeed.
            logger.warn(
              `Failed to remove Docker volumes for app ${appId}. Continuing: ${error}`,
            );
          }
        }
      }

      logger.debug(
        `Executing app ${appId} in path ${app.path} after restart request`,
      );

      if (clearRuntimeLogs) {
        clearLogs(appId);
      }

      await executeApp({
        appPath,
        appId,
        event,
        isNeon: !!app.neonProjectId,
        installCommand: app.installCommand,
        startCommand: app.startCommand,
        invocationRef,
      });
    } catch (error) {
      logger.error(`Error restarting app ${appId}:`, error);
      throw error;
    }
  });
}

const DEFAULT_APP_READY_TIMEOUT_MS = 2 * 60 * 1_000;
const APP_READY_POLL_MS = 100;

async function delayUntilNextReadyPoll(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, APP_READY_POLL_MS);
  });
}

export async function waitForAppReady(
  appId: number,
  { timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const appInfo = runningApps.get(appId);
    if (!appInfo) {
      throw new DyadError(
        "The app process exited before the preview became ready",
        DyadErrorKind.External,
      );
    }
    if (appInfo.proxyUrl) {
      return;
    }

    await delayUntilNextReadyPoll();
  }

  throw new DyadError(
    "Timed out waiting for the app preview to become ready",
    DyadErrorKind.External,
  );
}
