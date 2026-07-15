import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { DyadError } from "@/errors/dyad_error";
import {
  createIpcErrorEnvelope,
  createIpcSuccessEnvelope,
} from "../contracts/core";
import { sendTelemetryException } from "../utils/telemetry";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { registerTrustedIpcHandler } from "./trusted_handle";

export function createLoggedHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    const handleError = (error: unknown, args: any[]) => {
      logger.error(`Error in ${fn.name}: args: ${JSON.stringify(args)}`, error);
      sendTelemetryException(error, { ipc_channel: channel });
      // Preserve DyadError so telemetry classification stay consistent.
      if (error instanceof DyadError) {
        return createIpcErrorEnvelope(error);
      }
      return createIpcErrorEnvelope(new Error(`[${channel}] ${error}`));
    };

    registerTrustedIpcHandler(
      channel,
      async (event: IpcMainInvokeEvent, ...args: any[]) => {
        logger.debug(
          `IPC: ${channel} called with args: ${JSON.stringify(args)}`,
        );
        try {
          const result = await fn(event, ...args);
          logger.debug(
            `IPC: ${channel} returned: ${JSON.stringify(result)?.slice(0, 100)}...`,
          );
          return createIpcSuccessEnvelope(result);
        } catch (error) {
          return handleError(error, args);
        }
      },
      {
        onTrustFailure: (error, _event, ...args) => handleError(error, args),
      },
    );
  };
}

export function createTestOnlyLoggedHandler(logger: log.LogFunctions) {
  if (!IS_TEST_BUILD) {
    // Returns a no-op function for non-e2e test builds.
    return () => {};
  }
  return createLoggedHandler(logger);
}
