import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import { promises as fsPromises } from "node:fs";

// Import our utility modules
import { withLock } from "../utils/lock_utils";
import { runningApps, stopAppByInfo } from "../utils/process_manager";
import log from "electron-log";
import { copyDir } from "../handlers/app_handlers";

export async function renameApp(
  appId: number,
  appName: string,
  appPath: string,
  logger: log.LogFunctions,
) {
  return withLock(appId, async () => {
    // Check if app exists
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    // Check for conflicts with existing apps
    const nameConflict = await db.query.apps.findFirst({
      where: eq(apps.name, appName),
    });

    const pathConflict = await db.query.apps.findFirst({
      where: eq(apps.path, appPath),
    });

    if (nameConflict && nameConflict.id !== appId) {
      throw new Error(`An app with the name '${appName}' already exists`);
    }

    if (pathConflict && pathConflict.id !== appId) {
      throw new Error(`An app with the path '${appPath}' already exists`);
    }

    // Stop the app if it's running
    if (runningApps.has(appId)) {
      const appInfo = runningApps.get(appId)!;
      try {
        await stopAppByInfo(appId, appInfo);
      } catch (error: any) {
        logger.error(`Error stopping app ${appId} before renaming:`, error);
        throw new Error(`Failed to stop app before renaming: ${error.message}`);
      }
    }

    const oldAppPath = getDyadAppPath(app.path);
    const newAppPath = getDyadAppPath(appPath);
    // Only move files if needed
    if (newAppPath !== oldAppPath) {
      // Move app files
      try {
        // Check if destination directory already exists
        if (fs.existsSync(newAppPath)) {
          throw new Error(`Destination path '${newAppPath}' already exists`);
        }

        // Create parent directory if it doesn't exist
        await fsPromises.mkdir(path.dirname(newAppPath), {
          recursive: true,
        });

        // Copy the directory without node_modules
        await copyDir(oldAppPath, newAppPath);
      } catch (error: any) {
        logger.error(
          `Error moving app files from ${oldAppPath} to ${newAppPath}:`,
          error,
        );
        throw new Error(`Failed to move app files: ${error.message}`);
      }

      try {
        // Delete the old directory
        await fsPromises.rm(oldAppPath, { recursive: true, force: true });
      } catch (error: any) {
        // Why is this just a warning? This happens quite often on Windows
        // because it has an aggressive file lock.
        //
        // Not deleting the old directory is annoying, but not a big deal
        // since the user can do it themselves if they need to.
        logger.warn(`Error deleting old app directory ${oldAppPath}:`, error);
      }
    }

    // Update app in database
    try {
      await db
        .update(apps)
        .set({
          name: appName,
          path: appPath,
        })
        .where(eq(apps.id, appId))
        .returning();

      return;
    } catch (error: any) {
      // Attempt to rollback the file move
      if (newAppPath !== oldAppPath) {
        try {
          // Copy back from new to old
          await copyDir(newAppPath, oldAppPath);
          // Delete the new directory
          await fsPromises.rm(newAppPath, { recursive: true, force: true });
        } catch (rollbackError) {
          logger.error(
            `Failed to rollback file move during rename error:`,
            rollbackError,
          );
        }
      }

      logger.error(`Error updating app ${appId} in database:`, error);
      throw new Error(`Failed to update app in database: ${error.message}`);
    }
  });
}
