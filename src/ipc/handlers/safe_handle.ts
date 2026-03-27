import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { sendTelemetryException } from "../utils/telemetry";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { isWebMode, webHandlerRegistry } from "./base";

function getIpcMain() {
  try {
    if (process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("electron").ipcMain as typeof import("electron")["ipcMain"];
    }
  } catch {
    // Not in Electron
  }
  return null;
}

export function createLoggedHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    if (isWebMode()) {
      // Web mode: register in the HTTP handler registry; event is a stub
      webHandlerRegistry.set(channel, async (body: unknown) => {
        logger.log(`IPC: ${channel} called`);
        try {
          const result = await fn({} as IpcMainInvokeEvent, body);
          logger.log(
            `IPC: ${channel} returned: ${JSON.stringify(result)?.slice(0, 100)}...`,
          );
          return result;
        } catch (error) {
          logger.error(`Error in ${fn.name}`, error);
          sendTelemetryException(error, { ipc_channel: channel });
          throw new Error(`[${channel}] ${error}`);
        }
      });
    } else {
      // Electron mode: register via ipcMain
      const ipcMain = getIpcMain();
      ipcMain?.handle(
        channel,
        async (event: IpcMainInvokeEvent, ...args: any[]) => {
          logger.log(`IPC: ${channel} called with args: ${JSON.stringify(args)}`);
          try {
            const result = await fn(event, ...args);
            logger.log(
              `IPC: ${channel} returned: ${JSON.stringify(result)?.slice(0, 100)}...`,
            );
            return result;
          } catch (error) {
            logger.error(
              `Error in ${fn.name}: args: ${JSON.stringify(args)}`,
              error,
            );
            sendTelemetryException(error, { ipc_channel: channel });
            throw new Error(`[${channel}] ${error}`);
          }
        },
      );
    }
  };
}

export function createTestOnlyLoggedHandler(logger: log.LogFunctions) {
  if (!IS_TEST_BUILD) {
    // Returns a no-op function for non-e2e test builds.
    return () => {};
  }
  return createLoggedHandler(logger);
}
