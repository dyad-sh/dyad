import { ipcMain, session } from "electron";

export const registerSessionHandlers = () => {
  ipcMain.handle("clear-session-data", async (_event) => {
    const defaultAppSession = session.defaultSession;

    await defaultAppSession.clearStorageData({
      storages: ["cookies", "localstorage"],
    });
    console.info(`[IPC] All session data cleared for default session`);
  });
};
