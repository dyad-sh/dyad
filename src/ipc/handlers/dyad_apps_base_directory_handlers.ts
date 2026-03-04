import { dialog } from "electron";
import { mkdir, stat, symlink, realpath } from "fs/promises";
import log from "electron-log";
import { join, isAbsolute } from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { desc } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { getDyadAppsBaseDirectory, invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { writeSettings } from "@/main/settings";

const logger = log.scope("dyad_apps_base_directory_handlers");

export function registerDyadAppsBaseDirectoryHandlers() {
  createTypedHandler(systemContracts.getDyadAppsBaseDirectory, async () => {
    const { path, isCustomPath } = getDyadAppsBaseDirectory();

    return {
      path,
      isCustomPath,
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
      const { path: prevCustomPath, defaultPath } = getDyadAppsBaseDirectory();
      let newDyadAppsBaseDir = defaultPath; // If input is null/falsey, reset to default

      if (input) {
        let st;
        try {
          st = await stat(input);
        } catch {
          // Setting up to check existence+type; fall through
        }

        if (!st || !st.isDirectory())
          throw new Error("Path is not a directory");

        newDyadAppsBaseDir = input;
      }

      await mkdir(newDyadAppsBaseDir, { recursive: true });

      const allApps = await db.query.apps.findMany({
        orderBy: [desc(apps.createdAt)],
      });

      // We don't want to make current apps inaccessible after changing the directory.
      // So, we add symlinks in the new directory to each of the user's apps.
      for (const app of allApps) {
        if (isAbsolute(app.path)) continue;

        const link = join(newDyadAppsBaseDir, app.path);
        let target = join(prevCustomPath, app.path);

        // Make sure we link to original directory, not a symlink
        try {
          target = await realpath(target);
        } catch {
          // Fall through. If realpath fails, we keep the original path
        }

        try {
          // On Windows, symlinks require more permissions than junctions.
          // Try symlink first; if that fails, fall back to a junction
          if (process.platform === "win32") {
            try {
              await symlink(target, link, "dir");
              continue;
            } catch {
              // Only handle errors on second attempt; fall through
            }
          }

          await symlink(target, link, "junction");
        } catch (err: any) {
          // If we already have access to the app (or one with the same name),
          // or the app no longer exists, then we can safely skip the symlink
          if (err.code === "EEXIST" || err.code === "ENOENT") {
            logger.debug(
              [
                "Skipping symlink creation",
                `FROM: ${link}`,
                `TO: ${target}`,
                `REASON: ${err.code}`,
              ].join("\n"),
            );
            continue;
          }

          // We stop the settings change if we're removing access to apps
          logger.error(
            [
              "Failed to create required symlink",
              `FROM: ${link}`,
              `TO: ${target}`,
              `ERROR: ${err.code ?? err.message}`,
            ].join("\n"),
          );
          throw err;
        }
      }

      writeSettings({ customDyadAppsBaseDirectory: input });
      invalidateDyadAppsBaseDirectoryCache();
    },
  );
}
