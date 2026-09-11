import { session } from "electron";
import fs from "node:fs/promises";
import { getTypeScriptCachePath } from "@/paths/paths";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { runningApps } from "../utils/process_manager";
import { isAppPreviewStorageScopeAllowed } from "../utils/app_preview_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { DEFAULT_ENABLE_LOCALHOST_PREVIEW_ISOLATION } from "@/shared/settings_defaults";

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
      const isolationEnabled =
        readSettings().enableLocalhostPreviewIsolation ??
        DEFAULT_ENABLE_LOCALHOST_PREVIEW_ISOLATION;
      if (
        !isAppPreviewStorageScopeAllowed(
          input.appId,
          parsedPreviewUrl.hostname,
          isolationEnabled,
        )
      ) {
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
