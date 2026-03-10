import { dialog } from "electron";
import { mkdir, stat } from "fs/promises";
import log from "electron-log";
import { join, isAbsolute, normalize } from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import {
  getDefaultDyadAppsDirectory,
  getDyadAppsBaseDirectory,
  invalidateDyadAppsBaseDirectoryCache,
} from "@/paths/paths";
import { gitAddSafeDirectory } from "../utils/git_utils";
import { readSettings, writeSettings } from "@/main/settings";

const logger = log.scope("dyad_apps_base_directory_handlers");

export function registerDyadAppsBaseDirectoryHandlers() {
  createTypedHandler(systemContracts.getDyadAppsBaseDirectory, async () => {
    invalidateDyadAppsBaseDirectoryCache(); // ensure UI is up-to-date
    return getDyadAppsBaseDirectory();
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

    let st;
    try {
      st = await stat(filePaths[0]);
    } catch {
      // Just setting up to check directory existence, so fall through
    }

    if (!st || !st.isDirectory()) {
      return { path: null, canceled: false };
    }

    return { path: filePaths[0], canceled: false };
  });

  createTypedHandler(
    systemContracts.setDyadAppsBaseDirectory,
    async (_, input) => {
      const { path: prevPath, defaultPath } = getDyadAppsBaseDirectory();
      let newDyadAppsBaseDir = defaultPath;
      let updatedSettingValue = null;

      if (input) {
        let st;
        try {
          st = await stat(input);
        } catch {
          // Setting up to check existence+type; fall through
        }

        if (!st || !st.isDirectory())
          throw new Error("Path is not a directory");

        newDyadAppsBaseDir = normalize(input);
        updatedSettingValue = newDyadAppsBaseDir;
      }

      await mkdir(newDyadAppsBaseDir, { recursive: true });

      logger.info("Beginning path updates");

      const allApps = await db.query.apps.findMany();

      // We don't want to make current apps inaccessible after changing the directory.
      // So, convert all current apps to absolute paths.
      db.transaction((tx) => {
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
    },
  );
}
