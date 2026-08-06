import type { IpcMainInvokeEvent } from "electron";

import type { AppRunInvocationRef } from "@/app_run/state";
import { appRuntimeService } from "./app_runtime_service";
import { getIpcAppRuntimeOutput } from "./app_runtime_transport";

export interface RestartAppOptions {
  appId: number;
  invocationRef?: AppRunInvocationRef;
  removeNodeModules?: boolean;
  recreateSandbox?: boolean;
  clearRuntimeLogs?: boolean;
}

/**
 * Compatibility adapter for internal callers that still own an IPC event.
 * New main-process callers should consume appRuntimeService directly.
 */
export function restartApp(
  event: IpcMainInvokeEvent,
  options: RestartAppOptions,
): Promise<void> {
  return appRuntimeService.restart({
    ...options,
    output: getIpcAppRuntimeOutput(event.sender),
  });
}

export function waitForAppReady(
  appId: number,
  options?: { timeoutMs?: number },
): Promise<void> {
  return appRuntimeService.waitForReady(appId, options).then(() => undefined);
}
