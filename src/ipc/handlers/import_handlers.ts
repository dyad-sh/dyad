import { dialog } from "electron";
import fs from "fs/promises";
import path from "path";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getDyadAppPath } from "../../paths/paths";
import { apps } from "@/db/schema";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import git from "isomorphic-git";

import { ImportAppParams, ImportAppResult } from "../ipc_types";
import { copyDirectoryRecursive } from "../utils/file_utils";
import { gitCommit } from "../utils/git_utils";

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
  handle("check-app-name", async (_, { appName }: { appName: string }) => {
    // Check filesystem
    const appPath = getDyadAppPath(appName);
    try {
      await fs.access(appPath);
      return { exists: true };
    } catch {
      // Path doesn't exist, continue checking database
    }

    // Check database
    const existingApp = await db.query.apps.findFirst({
      where: eq(apps.name, appName),
    });

    return { exists: !!existingApp };
  });

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
      }: ImportAppParams,
    ): Promise<ImportAppResult> => {
      // Validate the source path exists
      try {
        await fs.access(sourcePath);
      } catch {
        throw new Error("Source folder does not exist");
      }

      const destPath = getDyadAppPath(appName);

      // Check if the app already exists
      const errorMessage = "An app with this name already exists";
      try {
        await fs.access(destPath);
        throw new Error(errorMessage);
      } catch (error: any) {
        if (error.message === errorMessage) {
          throw error;
        }
      }
      // Copy the app folder to the Dyad apps directory.
      // Why not use fs.cp? Because we want stable ordering for
      // tests.
      await copyDirectoryRecursive(sourcePath, destPath);

      const isGitRepo = await fs
        .access(path.join(destPath, ".git"))
        .then(() => true)
        .catch(() => false);
      if (!isGitRepo) {
        // Initialize git repo and create first commit
        await git.init({
          fs: fs,
          dir: destPath,
          defaultBranch: "main",
        });

        // Stage all files
        await git.add({
          fs: fs,
          dir: destPath,
          filepath: ".",
        });

        // Create initial commit
        await gitCommit({
          path: destPath,
          message: "Init Dyad app",
        });
      }

      // Create a new app
      const [app] = await db
        .insert(apps)
        .values({
          name: appName,
          // Use the name as the path for now
          path: appName,
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
