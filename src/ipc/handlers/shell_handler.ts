import { ipcMain, shell } from "electron";
import log from "electron-log";

const logger = log.scope("shell_handlers");

export function registerShellHandlers() {
  ipcMain.handle("open-external-url", async (_event, url: string) => {
    try {
      // Basic validation to ensure it's a http/https url
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        await shell.openExternal(url);
        logger.debug("Opened external URL:", url);
        return { success: true };
      }
      logger.error("Attempted to open invalid or non-http URL:", url);
      return {
        success: false,
        error: "Invalid URL provided. Only http/https URLs are allowed.",
      };
    } catch (error) {
      logger.error(`Failed to open external URL ${url}:`, error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("show-item-in-folder", async (_event, fullPath: string) => {
    try {
      // Validate that a path was provided
      if (!fullPath) {
        logger.error("Attempted to show item with empty path");
        return {
          success: false,
          error: "No file path provided.",
        };
      }

      shell.showItemInFolder(fullPath);
      logger.debug("Showed item in folder:", fullPath);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to show item in folder ${fullPath}:`, error);
      return { success: false, error: (error as Error).message };
    }
  });
}
