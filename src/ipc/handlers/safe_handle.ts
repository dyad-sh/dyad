import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";

export function createLoggedHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    ipcMain.handle(
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
          throw new Error(`[${channel}] ${error}`);
        }
      },
    );
  };
}
