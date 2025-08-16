import { dialog } from "electron";
import fs from "fs/promises";
import path from "path";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { apps } from "@/db/schema";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import git from "isomorphic-git";

import { ImportAppParams, ImportAppResult } from "../ipc_types";
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
    // Only check the database since we no longer copy to a fixed path
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
      { path: sourcePath, appName }: ImportAppParams,
    ): Promise<ImportAppResult> => {
      // Validate the source path exists
      try {
        await fs.access(sourcePath);
      } catch {
        throw new Error("Source folder does not exist");
      }

      const destPath = sourcePath;

      // Ensure app name and path are unique in the database
      const existingApp = await db.query.apps.findFirst({
        where: eq(apps.name, appName),
      });
      if (existingApp) {
        throw new Error("An app with this name already exists");
      }
      const existingPath = await db.query.apps.findFirst({
        where: eq(apps.path, destPath),
      });
      if (existingPath) {
        throw new Error("An app with this path already exists");
      }

      // Initialize git repo if needed in the imported directory
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
          // Store the actual imported path
          path: destPath,
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
