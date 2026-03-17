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

const logger = log.scope("dyad_apps_base_directory_handlers");

/**
 * Given a base directory, changes the paths of apps from relative to absolute.
 * This function is meant to be called multiple times, so `passNum` can be used
 * to differentiate the calls when logging.
 */
async function convertRelativePathsToAbsolute(
  relativeBaseDir: string,
  passNum: number,
) {
  const allApps = await db.query.apps.findMany();

  // We don't want to make current apps inaccessible after changing the directory.
  // So, convert all current apps to absolute paths.
  db.transaction((tx) => {
    for (const app of allApps) {
      if (isAbsolute(app.path)) {
        logger.info(
          `Pass ${passNum} -- ${app.name} already has an absolute path; skipping path update`,
        );
        continue;
      }

      const newPath = join(relativeBaseDir, app.path);
      logger.info(
        `Pass ${passNum} -- updating ${app.name} from relative path ${app.path} to absolute path ${newPath}`,
      );
      tx.update(apps)
        .set({
          path: newPath,
        })
        .where(eq(apps.id, app.id))
        .run();
    }
  });
}

export function registerDyadAppsBaseDirectoryHandlers() {
  createTypedHandler(systemContracts.getDyadAppsBaseDirectory, async () => {
    invalidateDyadAppsBaseDirectoryCache(); // ensure UI is up-to-date
    const directory = getDyadAppsBaseDirectory();

    return {
      path: directory,
      isPathAvailable: isDirectoryAccessible(directory),
      isPathDefault: getCustomFolderCache() == null, // if null or undefined
    };
  });

  createTypedHandler(systemContracts.selectDyadAppsBaseDirectory, async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: "Select Dyad Apps Folder",
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

  createTypedHandler(
    systemContracts.setDyadAppsBaseDirectory,
    async (_, input) => {
      // Ensure fresh settings read
      invalidateDyadAppsBaseDirectoryCache();

      const prevPath = getDyadAppsBaseDirectory();
      let newDyadAppsBaseDir = getDefaultDyadAppsDirectory();
      let updatedSettingValue = null;

      if (input) {
        // Custom path; cannot be relative
        if (!isAbsolute(input))
          throw new Error("Directory path is not absolute");

        // Make sure it exists
        if (!isDirectoryAccessible(input))
          throw new Error("Path is not a directory");

        newDyadAppsBaseDir = normalize(input);
        updatedSettingValue = newDyadAppsBaseDir;
      } else {
        // Resetting to default
        await mkdir(newDyadAppsBaseDir, { recursive: true });
      }

      logger.info("Beginning path updates");
      await convertRelativePathsToAbsolute(prevPath, 1);

      // Add dyad-apps directory to git safe.directory (required for Windows).
      // The trailing /* allows access to all repositories under the named directory.
      // See: https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory
      if (readSettings().enableNativeGit) {
        const directory = updatedSettingValue ?? getDefaultDyadAppsDirectory();

        // Don't need to await because this only needs to run before
        // the user starts interacting with Dyad app and uses a git-related feature.
        gitAddSafeDirectory(`${directory}/*`);
      }

      writeSettings({
        customAppsFolder: updatedSettingValue,
      });
      invalidateDyadAppsBaseDirectoryCache();

      // We call this a second time to prevent a theoretical race condition
      // where a new app gets created during the first path migration, thus
      // leaving an inaccessible app with a relative path.
      // In practice, this will almost certainly never happen anyway,
      // but it's easy enough to guard against.
      await convertRelativePathsToAbsolute(prevPath, 2);
    },
  );
}
