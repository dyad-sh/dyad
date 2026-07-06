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
import { gitService } from "../services/git_service";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getInitialChatModeForNewChat } from "./chat_mode_resolution";
import {
  sanitizeAppDisplayName,
  slugifyAppFolderName,
} from "@/shared/app_names";
import { resolveUniqueFolderName } from "../utils/app_name_resolution";

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

  // Handler for checking if an app name is already taken. Only the display
  // name can hard-conflict — folder names are derived slugs that auto-suffix
  // past filesystem collisions.
  handle("check-app-name", async (_, { appName }: { appName: string }) => {
    const existingApp = await db.query.apps.findFirst({
      where: eq(apps.name, sanitizeAppDisplayName(appName)),
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
        installCommand,
        startCommand,
        skipCopy,
        ...params
      }: ImportAppParams,
    ): Promise<ImportAppResult> => {
      const appName = sanitizeAppDisplayName(params.appName);
      // Validate the source path exists
      try {
        await fs.access(sourcePath);
      } catch {
        throw new DyadError(
          "Source folder does not exist",
          DyadErrorKind.NotFound,
        );
      }

      // The display name conflicting is a hard error (the import dialog
      // pre-checks it); folder collisions auto-resolve with a suffix.
      const existingApp = await db.query.apps.findFirst({
        where: eq(apps.name, appName),
      });
      if (existingApp) {
        throw new DyadError(
          "An app with this name already exists",
          DyadErrorKind.Conflict,
        );
      }

      // Determine the app path based on skipCopy
      let folderName: string | null = null;
      if (!skipCopy) {
        folderName = await resolveUniqueFolderName(
          slugifyAppFolderName(appName),
        );
      }
      const appPath = skipCopy ? sourcePath : getDyadAppPath(folderName!);

      if (!skipCopy) {
        if (!isAppLocationAccessible(appPath)) {
          throw new Error(
            `The path ${appPath} is inaccessible. Please check your custom apps folder setting.`,
          );
        }

        // Copy the app folder to the Dyad apps directory.
        // Why not use fs.cp? Because we want stable ordering for
        // tests.
        await copyDirectoryRecursive(sourcePath, appPath);
      }

      const isGitRepo = await fs
        .access(path.join(appPath, ".git"))
        .then(() => true)
        .catch(() => false);
      if (!isGitRepo) {
        // Initialize git repo and create first commit
        await gitService.initRepoWithInitialCommit({ path: appPath });
      }

      // Create a new app
      // Store the full absolute path when skipCopy is true, otherwise store
      // the derived folder name.
      // Imported apps don't need an app blueprint — the schema default (false) is correct.
      const [app] = await db
        .insert(apps)
        .values({
          name: appName,
          path: skipCopy ? sourcePath : folderName!,
          installCommand: installCommand ?? null,
          startCommand: startCommand ?? null,
        })
        .returning();

      const initialChatMode = await getInitialChatModeForNewChat();

      // Create an initial chat for this app
      const [chat] = await db
        .insert(chats)
        .values({
          appId: app.id,
          chatMode: initialChatMode,
        })
        .returning();
      return { appId: app.id, chatId: chat.id };
    },
  );

  logger.debug("Registered import IPC handlers");
}
