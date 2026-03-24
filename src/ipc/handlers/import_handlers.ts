import { dialog } from "electron";
import fs from "fs/promises";
import path from "path";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getDyadAppPath, isAppLocationAccessible } from "../../paths/paths";
import { apps } from "@/db/schema";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";

import { ImportAppParams, ImportAppResult } from "@/ipc/types";
import { copyDirectoryRecursive } from "../utils/file_utils";
import {
  gitCommit,
  gitAdd,
  gitInit,
  gitAddSafeDirectory,
} from "../utils/git_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { pathExistsHandlingWslAsync, isWslPath } from "../utils/wsl_path_utils";

const logger = log.scope("import-handlers");
const handle = createLoggedHandler(logger);

export function registerImportHandlers() {
  // Handler for selecting an app folder
  handle("select-app-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select App Folder to Import",
    });

    if (result.canceled) {
      return { path: null, name: null };
    }

    const selectedPath = result.filePaths[0];
    const folderName = path.basename(selectedPath);

    return { path: selectedPath, name: folderName };
  });

  // Handler for checking if AI_RULES.md exists
  handle("check-ai-rules", async (_, { path: appPath }: { path: string }) => {
    try {
      await fs.access(path.join(appPath, "AI_RULES.md"));
      return { exists: true };
    } catch {
      return { exists: false };
    }
  });

  // Handler for checking if an app name is already taken
  handle(
    "check-app-name",
    async (
      _,
      { appName, skipCopy }: { appName: string; skipCopy?: boolean },
    ) => {
      // Only check filesystem if we're copying to dyad-apps
      if (!skipCopy) {
        const appPath = getDyadAppPath(appName);
        try {
          await fs.access(appPath);
          return { exists: true };
        } catch {
          // Path doesn't exist, continue checking database
        }
      }

      // Check database
      const existingApp = await db.query.apps.findFirst({
        where: eq(apps.name, appName),
      });

      return { exists: !!existingApp };
    },
  );

  // Handler for importing an app
  handle(
    "import-app",
    async (
      _,
      {
        path: sourcePath,
        appName,
        installCommand,
        startCommand,
        skipCopy,
      }: ImportAppParams,
    ): Promise<ImportAppResult> => {
      // Validate the source path exists with WSL-safe check
      if (!(await pathExistsHandlingWslAsync(sourcePath))) {
        throw new DyadError(
          "Source folder does not exist",
          DyadErrorKind.NotFound,
        );
      }

      const appPath = skipCopy ? sourcePath : getDyadAppPath(appName);

      // Prevent skip-copy imports for WSL paths: the app would remain on a UNC
      // path, but chat edit operations (response_processor.ts, copy_file_utils.ts)
      // still use sync fs calls that fail on UNC paths. Copy-based imports work
      // because files are copied to non-WSL storage.
      if (skipCopy && isWslPath(sourcePath)) {
        throw new Error(
          "Skip-copy import not supported for WSL paths. Please choose 'Copy to Dyad' instead.",
        );
      }

      // For regular (non-skip-copy) WSL imports, register the source UNC path
      // as safe before running git operations if needed for version tracking.
      if (!skipCopy && isWslPath(sourcePath)) {
        await gitAddSafeDirectory(sourcePath);
      }

      if (!skipCopy) {
        if (!isAppLocationAccessible(appPath)) {
          throw new Error(
            `The path ${appPath} is inaccessible. Please check your custom apps folder setting.`,
          );
        }

        // Check if the app already exists in dyad-apps
        const errorMessage = "An app with this name already exists";
        try {
          await fs.access(appPath);
          throw new Error(errorMessage);
        } catch (error: any) {
          if (error.message === errorMessage) {
            throw error;
          }
        }
        // Copy the app folder to the Dyad apps directory.
        // Why not use fs.cp? Because we want stable ordering for
        // tests.
        await copyDirectoryRecursive(sourcePath, appPath);
      }

      const isGitRepo = await pathExistsHandlingWslAsync(
        path.join(appPath, ".git"),
      );
      if (!isGitRepo) {
        // Initialize git repo and create first commit
        await gitInit({ path: appPath, ref: "main" });

        // Stage all files

        await gitAdd({ path: appPath, filepath: "." });

        // Create initial commit
        await gitCommit({
          path: appPath,
          message: "Init Dyad app",
        });
      }

      // Create a new app
      // Store the full absolute path when skipCopy is true, otherwise store appName
      const [app] = await db
        .insert(apps)
        .values({
          name: appName,
          path: skipCopy ? sourcePath : appName,
          installCommand: installCommand ?? null,
          startCommand: startCommand ?? null,
        })
        .returning();

      // Create an initial chat for this app
      const [chat] = await db
        .insert(chats)
        .values({
          appId: app.id,
        })
        .returning();
      return { appId: app.id, chatId: chat.id };
    },
  );

  logger.debug("Registered import IPC handlers");
}
