import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { IS_TEST_BUILD } from "../utils/test_utils";

// Channels whose arguments should not be logged (may contain sensitive user input)
const REDACTED_CHANNELS = new Set(["terminal:write"]);

export function createLoggedHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: any[]) => {
        const argsStr = REDACTED_CHANNELS.has(channel)
          ? "[redacted]"
          : JSON.stringify(args);
        logger.log(`IPC: ${channel} called with args: ${argsStr}`);
        try {
          const result = await fn(event, ...args);
          logger.log(
            `IPC: ${channel} returned: ${JSON.stringify(result)?.slice(0, 100)}...`,
          );
          return result;
        } catch (error) {
          logger.error(`Error in ${fn.name}: args: ${argsStr}`, error);
          throw new Error(`[${channel}] ${error}`);
        }
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
