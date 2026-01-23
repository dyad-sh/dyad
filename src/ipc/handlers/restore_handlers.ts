import fs from "fs/promises";
import path from "path";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getDyadAppsBaseDirectory, getDyadAppPath } from "../../paths/paths";
import { apps, chats } from "@/db/schema";
import { db } from "@/db";
import { SyncAppsFromFolderResult } from "../ipc_types";
import { gitCommit, gitAdd, gitInit } from "../utils/git_utils";

const logger = log.scope("restore-handlers");
const handle = createLoggedHandler(logger);

export function registerRestoreHandlers() {
  handle(
    "sync-apps-from-folder",
    async (): Promise<SyncAppsFromFolderResult> => {
      const result: SyncAppsFromFolderResult = {
        imported: [],
        skipped: [],
        errors: [],
      };

      const dyadAppsDir = getDyadAppsBaseDirectory();

      // Check if dyad-apps directory exists
      try {
        await fs.access(dyadAppsDir);
      } catch {
        // Directory doesn't exist, return empty result
        logger.info(
          `dyad-apps directory does not exist at ${dyadAppsDir}, nothing to sync`,
        );
        return result;
      }

      // Get all subdirectories in dyad-apps
      const entries = await fs.readdir(dyadAppsDir, { withFileTypes: true });
      const folders = entries.filter((entry) => entry.isDirectory());

      // Get all existing apps from database
      const existingApps = await db.query.apps.findMany();
      const existingPaths = new Set(
        existingApps.map((app) => getDyadAppPath(app.path)),
      );

      for (const folder of folders) {
        const folderPath = path.join(dyadAppsDir, folder.name);

        try {
          // Check if this folder is already tracked in the database
          if (existingPaths.has(folderPath)) {
            result.skipped.push(folder.name);
            logger.debug(
              `Skipping ${folder.name}: already tracked in database`,
            );
            continue;
          }

          // Check if the folder has a package.json (valid app)
          const packageJsonPath = path.join(folderPath, "package.json");
          try {
            await fs.access(packageJsonPath);
          } catch {
            result.skipped.push(folder.name);
            logger.debug(
              `Skipping ${folder.name}: no package.json found (not a valid app)`,
            );
            continue;
          }

          // Initialize git if needed
          const isGitRepo = await fs
            .access(path.join(folderPath, ".git"))
            .then(() => true)
            .catch(() => false);

          if (!isGitRepo) {
            await gitInit({ path: folderPath, ref: "main" });
            await gitAdd({ path: folderPath, filepath: "." });
            await gitCommit({
              path: folderPath,
              message: "Init Dyad app",
            });
          }

          // Create database entry for the app
          const [app] = await db
            .insert(apps)
            .values({
              name: folder.name,
              path: folder.name, // Store relative path
            })
            .returning();

          // Create an initial chat for this app
          await db.insert(chats).values({
            appId: app.id,
          });

          result.imported.push(folder.name);
          logger.info(`Imported app: ${folder.name}`);
        } catch (error: any) {
          result.errors.push({
            folder: folder.name,
            error: error.message || "Unknown error",
          });
          logger.error(`Error importing ${folder.name}: ${error.message}`);
        }
      }

      logger.info(
        `Sync complete: ${result.imported.length} imported, ${result.skipped.length} skipped, ${result.errors.length} errors`,
      );
      return result;
    },
  );

  logger.debug("Registered restore IPC handlers");
}
