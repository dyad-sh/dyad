import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";

export function createSafeHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: any[]) => {
        try {
          return await fn(event, ...args);
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
