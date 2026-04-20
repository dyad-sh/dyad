import os from "node:os";
import path from "node:path";
import { promises as fsPromises } from "node:fs";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAllTemplates } from "../utils/template_utils";
import { localTemplatesData } from "../../shared/templates";
import { createTypedHandler } from "./base";
import { templateContracts } from "../types/templates";
import { getDyadAppPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import { runningApps, stopAppByInfo } from "../utils/process_manager";
import { createFromTemplate } from "./createFromTemplate";
import {
  gitAdd,
  gitCommit,
  hasStagedChanges,
  isGitStatusClean,
} from "../utils/git_utils";

const logger = log.scope("template_handlers");

const PRESERVED_TEMPLATE_PATHS = new Set([".git", ".dyad"]);

function shouldPreservePath(name: string): boolean {
  return PRESERVED_TEMPLATE_PATHS.has(name) || name.startsWith(".env");
}

async function clearAppDirectoryForTemplateSwap(appPath: string) {
  const entries = await fsPromises.readdir(appPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (shouldPreservePath(entry.name)) {
        return;
      }

      await fsPromises.rm(path.join(appPath, entry.name), {
        recursive: true,
        force: true,
      });
    }),
  );
}

export function registerTemplateHandlers() {
  createTypedHandler(templateContracts.getTemplates, async () => {
    try {
      const templates = await getAllTemplates();
      return templates;
    } catch (error) {
      logger.error("Error fetching templates:", error);
      return localTemplatesData;
    }
  });

  createTypedHandler(templateContracts.applyAppTemplate, async (_, params) => {
    const { appId, templateId, chatId } = params;

    return withLock(appId, async () => {
      const appRecord = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!appRecord) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      const appPath = getDyadAppPath(appRecord.path);
      const isClean = await isGitStatusClean({ path: appPath });

      if (!isClean) {
        throw new DyadError(
          "Cannot change templates after local modifications. Please commit or discard your changes first.",
          DyadErrorKind.Precondition,
        );
      }

      const tempRoot = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), "dyad-template-"),
      );
      const stagedTemplatePath = path.join(tempRoot, "app");

      try {
        try {
          await createFromTemplate({
            fullAppPath: stagedTemplatePath,
            templateId,
          });

          const appInfo = runningApps.get(appId);
          if (appInfo) {
            await stopAppByInfo(appId, appInfo);
          }

          await clearAppDirectoryForTemplateSwap(appPath);
          await fsPromises.cp(stagedTemplatePath, appPath, { recursive: true });
        } catch (error) {
          logger.error(
            `Failed to stage template ${templateId} for app ${appId} at ${appPath}:`,
            error,
          );
          throw error;
        }
      } finally {
        await fsPromises.rm(tempRoot, {
          recursive: true,
          force: true,
        });
      }

      await gitAdd({ path: appPath, filepath: "." });

      // If the clear-and-recopy produced no effective diff (e.g. the template
      // is already applied), skip the commit — git would fail with "nothing to
      // commit" — and report that no change was applied.
      if (!(await hasStagedChanges({ path: appPath }))) {
        logger.info(
          `Template ${templateId} already applied to app ${appId}, skipping commit`,
        );
        return { applied: false };
      }

      const commitHash = await gitCommit({
        path: appPath,
        message: `Apply ${templateId} template`,
      });

      if (chatId) {
        const chatRecord = await db.query.chats.findFirst({
          where: eq(chats.id, chatId),
          columns: { initialCommitHash: true },
        });
        if (!chatRecord?.initialCommitHash) {
          await db
            .update(chats)
            .set({ initialCommitHash: commitHash })
            .where(eq(chats.id, chatId));
        }
      }

      return { applied: true };
    });
  });
}
