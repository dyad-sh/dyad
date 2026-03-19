import { dialog } from "electron";
import { mkdir } from "fs/promises";
import log from "electron-log";
import { join, isAbsolute, normalize } from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import {
  getCustomFolderCache,
  getDefaultDyadAppsDirectory,
  getDyadAppsBaseDirectory,
  invalidateDyadAppsBaseDirectoryCache,
  isDirectoryAccessible,
} from "@/paths/paths";
import { gitAddSafeDirectory } from "../utils/git_utils";
import { readSettings, writeSettings } from "@/main/settings";

const logger = log.scope("custom_apps_folder_handlers");

export function registerCustomAppsFolderHandlers() {
  createTypedHandler(systemContracts.getCustomAppsFolder, async () => {
    invalidateDyadAppsBaseDirectoryCache(); // ensure UI is up-to-date
    const directory = getDyadAppsBaseDirectory();

    return {
      path: directory,
      isPathAvailable: isDirectoryAccessible(directory),
      isPathDefault: getCustomFolderCache() == null, // if null or undefined
    };
  });

  createTypedHandler(systemContracts.selectCustomAppsFolder, async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: "Select Custom Apps Folder",
      properties: ["openDirectory"],
      message: "Select the folder where Dyad apps should be stored",
    });

    if (canceled) {
      return { path: null, canceled: true };
    }

    const dirPath = filePaths[0];
    if (!dirPath || !isAbsolute(dirPath) || !isDirectoryAccessible(dirPath)) {
      return { path: null, canceled: false };
    }

    return { path: dirPath, canceled: false };
  });

  createTypedHandler(systemContracts.setCustomAppsFolder, async (_, input) => {
    // Ensure fresh settings read
    invalidateDyadAppsBaseDirectoryCache();

    const prevPath = getDyadAppsBaseDirectory();
    let newDyadAppsBaseDir = getDefaultDyadAppsDirectory();
    let updatedSettingValue = null;

    if (input) {
      // Custom path; cannot be relative
      if (!isAbsolute(input)) throw new Error("Directory path is not absolute");

      // Make sure it exists
      if (!isDirectoryAccessible(input))
        throw new Error("Path is not a directory");

      newDyadAppsBaseDir = normalize(input);
      updatedSettingValue = newDyadAppsBaseDir;
    } else {
      // Resetting to default
      await mkdir(newDyadAppsBaseDir, { recursive: true });
    }

    // Only convert paths and make git config changes if the user selected
    // a directory different from the one they're currently using
    if (newDyadAppsBaseDir !== prevPath) {
      logger.info("Beginning path updates");

      // We don't want to make current apps inaccessible after changing the directory.
      // So, convert all current apps to absolute paths.
      db.transaction((tx) => {
        const allApps = tx.select().from(apps).all();
        for (const app of allApps) {
          if (isAbsolute(app.path)) {
            logger.info(
              `${app.name} already has an absolute path; skipping path update`,
            );
            continue;
          }

          const newPath = join(prevPath, app.path);
          logger.info(
            `updating ${app.name} from relative path ${app.path} to absolute path ${newPath}`,
          );
          tx.update(apps)
            .set({
              path: newPath,
            })
            .where(eq(apps.id, app.id))
            .run();
        }
      });

      // Add custom apps folder to git safe.directory (required for Windows).
      // The trailing /* allows access to all repositories under the named directory.
      // See: https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory
      if (readSettings().enableNativeGit) {
        const directory = updatedSettingValue ?? getDefaultDyadAppsDirectory();
        await gitAddSafeDirectory(`${directory}/*`);
      }
    }

    writeSettings({
      customAppsFolder: updatedSettingValue,
    });
    invalidateDyadAppsBaseDirectoryCache();
  });
}
