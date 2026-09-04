import { session } from "electron";
import fs from "node:fs/promises";
import { getTypeScriptCachePath } from "@/paths/paths";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { runningApps } from "../utils/process_manager";
import { isAppPreviewHostname } from "../utils/app_preview_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const registerSessionHandlers = () => {
  createTypedHandler(
    systemContracts.clearSessionData,
    async (_event, input) => {
      const defaultAppSession = session.defaultSession;
      const previewUrl = runningApps.get(input.appId)?.proxyUrl;
      if (!previewUrl) {
        throw new DyadError(
          "The app preview is not running.",
          DyadErrorKind.Precondition,
        );
      }

      const parsedPreviewUrl = new URL(previewUrl);
      if (!isAppPreviewHostname(input.appId, parsedPreviewUrl.hostname)) {
        throw new DyadError(
          "The app preview does not have isolated browser storage.",
          DyadErrorKind.Precondition,
        );
      }

      await defaultAppSession.clearStorageData({
        origin: parsedPreviewUrl.origin,
        storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"],
      });
      console.info(`[IPC] Preview data cleared for app ${input.appId}`);

      // Clear custom cache data (like tsbuildinfo)
      try {
        await fs.rm(getTypeScriptCachePath(), { recursive: true, force: true });
      } catch {
        // Directory might not exist
      }
    },
  );
};
