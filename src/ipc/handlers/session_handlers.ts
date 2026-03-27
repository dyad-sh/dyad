import fs from "node:fs/promises";
import { getTypeScriptCachePath } from "@/paths/paths";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";

export const registerSessionHandlers = () => {
  createTypedHandler(systemContracts.clearSessionData, async () => {
    if (process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { session } = require("electron") as typeof import("electron");
      const defaultAppSession = session.defaultSession;
      await defaultAppSession.clearStorageData({
        storages: ["cookies", "localstorage"],
      });
      console.info(`[IPC] All session data cleared for default session`);
    }

    // Clear custom cache data (like tsbuildinfo)
    try {
      await fs.rm(getTypeScriptCachePath(), { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });
};
