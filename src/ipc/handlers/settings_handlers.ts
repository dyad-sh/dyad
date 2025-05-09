import { ipcMain } from "electron";
import type { UserSettings } from "../../lib/schemas";
import { writeSettings } from "../../main/settings";
import { readSettings } from "../../main/settings";

export function registerSettingsHandlers() {
  ipcMain.handle("get-user-settings", async () => {
    const settings = readSettings();
    return settings;
  });

  ipcMain.handle(
    "set-user-settings",
    async (_, settings: Partial<UserSettings>) => {
      writeSettings(settings);
      return readSettings();
    },
  );
}
