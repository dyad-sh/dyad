import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import log from "electron-log";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats, customThemes } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAllTemplates } from "../utils/template_utils";
import { localTemplatesData } from "../../shared/templates";
import { createTypedHandler } from "./base";
import { templateContracts } from "../types/templates";
import { getDyadAppPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import { runningApps, stopAppByInfo } from "../utils/process_manager";
import { createFromTemplate } from "./createFromTemplate";
import { ensureDyadGitignored } from "./gitignoreUtils";
import { slugifyAppFolderName } from "@/shared/app_names";
import { resolveUniqueFolderName } from "../utils/app_name_resolution";
import { getGitUncommittedFiles } from "../utils/git_utils";
import { gitService } from "../services/git_service";
import { themesData } from "@/shared/themes";

const logger = log.scope("template_handlers");

const PRESERVED_TEMPLATE_PATHS = new Set([".git", ".dyad"]);

function shouldPreservePath(name: string): boolean {
  return PRESERVED_TEMPLATE_PATHS.has(name) || name.startsWith(".env");
}

function pathsEqualCaseInsensitive(left: string, right: string): boolean {
  return (
    path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
  );
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

async function allocateNewAppPath({
  appId,
  newName,
}: {
  appId: number;
  newName: string;
}): Promise<{ newSlug: string; newAbsPath: string }> {
  // Shared app-naming policy: lowercase slug plus collision suffix, probed
  // against the DB and filesystem. Excluding the app itself means a folder
  // that is already the canonical slug is returned unchanged (no path swap).
  const newSlug = await resolveUniqueFolderName(slugifyAppFolderName(newName), {
    excludeAppId: appId,
  });
  return { newSlug, newAbsPath: getDyadAppPath(newSlug) };
}

async function copyPreservedEntries({
  fromPath,
  toPath,
}: {
  fromPath: string;
  toPath: string;
}) {
  const entries = await fsPromises.readdir(fromPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldPreservePath(entry.name)) continue;
    const target = path.join(toPath, entry.name);
    if (fs.existsSync(target)) {
      await fsPromises.rm(target, { recursive: true, force: true });
    }
    await fsPromises.cp(path.join(fromPath, entry.name), target, {
      recursive: true,
    });
  }
}

async function applyTemplateInPlace({
  appId,
  appPath,
  templateId,
}: {
  appId: number;
  appPath: string;
  templateId: string;
}): Promise<{ appWasStopped: boolean }> {
  const tempRoot = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "dyad-template-"),
  );
  const stagedTemplatePath = path.join(tempRoot, "app");

  let appWasStopped = false;
  try {
    try {
      await createFromTemplate({
        fullAppPath: stagedTemplatePath,
        templateId,
      });

      const appInfo = runningApps.get(appId);
      if (appInfo) {
        await stopAppByInfo(appId, appInfo);
        appWasStopped = true;
      }

      await clearAppDirectoryForTemplateSwap(appPath);
      await fsPromises.cp(stagedTemplatePath, appPath, { recursive: true });
    } catch (error) {
      logger.error(
        `Failed to stage template ${templateId} for app ${appId} at ${appPath}:`,
        error,
      );
      if (appWasStopped) {
        throw new DyadError(
          `Failed to apply template "${templateId}". The dev server was stopped before the failure and will need to be started manually. (${
            error instanceof Error ? error.message : String(error)
          })`,
          DyadErrorKind.Unknown,
        );
      }
      throw error;
    }
  } finally {
    await fsPromises.rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }

  return { appWasStopped };
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

  createTypedHandler(templateContracts.getThemes, async () => themesData);

  createTypedHandler(templateContracts.setAppTheme, async (_, params) => {
    await db
      .update(apps)
      .set({ themeId: params.themeId || sql`NULL` })
      .where(eq(apps.id, params.appId));
  });

  createTypedHandler(templateContracts.getAppTheme, async (_, params) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, params.appId),
      columns: { themeId: true },
    });
    return app?.themeId ?? null;
  });

  createTypedHandler(templateContracts.getCustomThemes, async () => {
    return db.query.customThemes.findMany({
      orderBy: (themes, { desc }) => [desc(themes.createdAt)],
    });
  });

  createTypedHandler(templateContracts.createCustomTheme, async (_, params) => {
    const name = params.name.trim();
    const description = params.description?.trim();
    const prompt = params.prompt.trim();

    if (!name) {
      throw new DyadError("Theme name is required", DyadErrorKind.Validation);
    }
    if (name.length > 100) {
      throw new DyadError(
        "Theme name must be less than 100 characters",
        DyadErrorKind.Validation,
      );
    }
    if (description && description.length > 500) {
      throw new DyadError(
        "Theme description must be less than 500 characters",
        DyadErrorKind.Validation,
      );
    }
    if (!prompt) {
      throw new DyadError("Theme prompt is required", DyadErrorKind.Validation);
    }
    if (prompt.length > 50_000) {
      throw new DyadError(
        "Theme prompt must be less than 50,000 characters",
        DyadErrorKind.Validation,
      );
    }

    const existingTheme = await db.query.customThemes.findFirst({
      where: sql`LOWER(${customThemes.name}) = LOWER(${name})`,
    });
    if (existingTheme) {
      throw new DyadError(
        `A theme named "${name}" already exists. Please choose a different name.`,
        DyadErrorKind.Conflict,
      );
    }

    const [theme] = await db
      .insert(customThemes)
      .values({
        name,
        description: description || null,
        prompt,
      })
      .returning();
    return theme;
  });

  createTypedHandler(templateContracts.updateCustomTheme, async (_, params) => {
    const currentTheme = await db.query.customThemes.findFirst({
      where: eq(customThemes.id, params.id),
    });
    if (!currentTheme) {
      throw new DyadError("Theme not found", DyadErrorKind.NotFound);
    }

    const updateData: Partial<{
      name: string;
      description: string | null;
      prompt: string;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (params.name !== undefined) {
      const name = params.name.trim();
      if (!name) {
        throw new DyadError("Theme name is required", DyadErrorKind.Validation);
      }
      if (name.length > 100) {
        throw new DyadError(
          "Theme name must be less than 100 characters",
          DyadErrorKind.Validation,
        );
      }
      const existingTheme = await db.query.customThemes.findFirst({
        where: sql`LOWER(${customThemes.name}) = LOWER(${name}) AND ${customThemes.id} != ${params.id}`,
      });
      if (existingTheme) {
        throw new DyadError(
          `A theme named "${name}" already exists. Please choose a different name.`,
          DyadErrorKind.Conflict,
        );
      }
      updateData.name = name;
    }

    if (params.description !== undefined) {
      const description = params.description.trim();
      if (description.length > 500) {
        throw new DyadError(
          "Theme description must be less than 500 characters",
          DyadErrorKind.Validation,
        );
      }
      updateData.description = description || null;
    }

    if (params.prompt !== undefined) {
      const prompt = params.prompt.trim();
      if (!prompt) {
        throw new DyadError(
          "Theme prompt is required",
          DyadErrorKind.Validation,
        );
      }
      if (prompt.length > 50_000) {
        throw new DyadError(
          "Theme prompt must be less than 50,000 characters",
          DyadErrorKind.Validation,
        );
      }
      updateData.prompt = prompt;
    }

    const [theme] = await db
      .update(customThemes)
      .set(updateData)
      .where(eq(customThemes.id, params.id))
      .returning();
    if (!theme) {
      throw new DyadError("Theme not found", DyadErrorKind.NotFound);
    }
    return theme;
  });

  createTypedHandler(templateContracts.deleteCustomTheme, async (_, params) => {
    await db.delete(customThemes).where(eq(customThemes.id, params.id));
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

      const oldAbsPath = getDyadAppPath(appRecord.path);
      const uncommittedFiles = await getGitUncommittedFiles({
        path: oldAbsPath,
      });

      if (uncommittedFiles.length > 0) {
        throw new DyadError(
          "Cannot change templates after local modifications. Please commit or discard your changes first.",
          DyadErrorKind.Precondition,
        );
      }

      // For imported (absolute path) apps, fall back to the in-place flow —
      // the user picked that folder location intentionally.
      const useInPlace = path.isAbsolute(appRecord.path);

      let workingPath = oldAbsPath;
      let newSlug: string | null = null;
      let newAbsPath: string | null = null;
      let didPathSwap = false;

      if (!useInPlace) {
        const allocated = await allocateNewAppPath({
          appId,
          newName: appRecord.name,
        });
        if (!pathsEqualCaseInsensitive(allocated.newAbsPath, oldAbsPath)) {
          newSlug = allocated.newSlug;
          newAbsPath = allocated.newAbsPath;
          didPathSwap = true;
        }
      }

      let appWasStopped = false;

      if (didPathSwap && newAbsPath && newSlug) {
        // Path-swap branch: build the template at a new directory, migrate
        // preserved files (.git, .dyad, .env*) from the old directory, update
        // the DB, then best-effort delete the old directory. This avoids
        // Windows file-lock failures on node_modules/build artifacts.
        const tempRoot = await fsPromises.mkdtemp(
          path.join(os.tmpdir(), "dyad-template-"),
        );
        const stagedTemplatePath = path.join(tempRoot, "app");

        let newDirCreated = false;
        let dbUpdated = false;
        let noOpAbort = false;

        try {
          await createFromTemplate({
            fullAppPath: stagedTemplatePath,
            templateId,
          });

          const appInfo = runningApps.get(appId);
          if (appInfo) {
            await stopAppByInfo(appId, appInfo);
            appWasStopped = true;
          }

          await fsPromises.mkdir(path.dirname(newAbsPath), { recursive: true });
          await fsPromises.cp(stagedTemplatePath, newAbsPath, {
            recursive: true,
          });
          newDirCreated = true;

          await copyPreservedEntries({
            fromPath: oldAbsPath,
            toPath: newAbsPath,
          });

          // The new template's `.gitignore` likely doesn't contain `.dyad/`,
          // so re-apply it before staging to keep internal metadata out of
          // git.
          await ensureDyadGitignored(newAbsPath);

          const commitHash = await gitService.stageAllAndCommitIfChanged({
            path: newAbsPath,
            message: `Apply ${templateId} template`,
          });

          if (commitHash === null) {
            // No-op: template produced the same content. Discard the new
            // dir, leave the DB pointing at the old path, and report no
            // apply. The dev server still needs restart if we stopped it.
            logger.info(
              `Template ${templateId} already applied to app ${appId}, skipping commit (path-swap branch)`,
            );
            noOpAbort = true;
            await fsPromises.rm(newAbsPath, { recursive: true, force: true });
            return { applied: false, needsRestart: appWasStopped };
          }

          await db
            .update(apps)
            .set({ path: newSlug })
            .where(eq(apps.id, appId));
          dbUpdated = true;

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
        } catch (error) {
          logger.error(
            `Failed to swap-apply template ${templateId} for app ${appId} (old=${oldAbsPath}, new=${newAbsPath}):`,
            error,
          );
          if (newDirCreated && !dbUpdated && !noOpAbort) {
            try {
              await fsPromises.rm(newAbsPath, {
                recursive: true,
                force: true,
              });
            } catch (cleanupError) {
              logger.warn(
                `Failed to clean up partial new app directory ${newAbsPath}:`,
                cleanupError,
              );
            }
          }
          if (appWasStopped) {
            throw new DyadError(
              `Failed to apply template "${templateId}". The dev server was stopped before the failure and will need to be started manually. (${
                error instanceof Error ? error.message : String(error)
              })`,
              DyadErrorKind.Unknown,
            );
          }
          throw error;
        } finally {
          await fsPromises.rm(tempRoot, {
            recursive: true,
            force: true,
          });
        }

        // Best-effort old-dir cleanup. Why is this just a warning? Windows
        // can hold aggressive file locks on build artifacts that survive a
        // dev-server stop. The user's app already lives at newAbsPath; a
        // leftover old directory is annoying but not fatal.
        try {
          await fsPromises.rm(oldAbsPath, { recursive: true, force: true });
        } catch (error) {
          logger.warn(`Error deleting old app directory ${oldAbsPath}:`, error);
        }

        return { applied: true, needsRestart: true };
      }

      // In-place branch (imported apps OR slug already matches existing path).
      ({ appWasStopped } = await applyTemplateInPlace({
        appId,
        appPath: workingPath,
        templateId,
      }));

      // The new template's `.gitignore` likely doesn't contain `.dyad/`, so
      // re-apply it before staging to keep internal metadata out of git.
      await ensureDyadGitignored(workingPath);

      // If the clear-and-recopy produced no effective diff (e.g. the template
      // is already applied), skip the commit — git would fail with "nothing to
      // commit" — and report that no change was applied. The dev server still
      // needs to be restarted if we stopped it above, otherwise the preview
      // would remain offline after a no-op apply.
      const commitHash = await gitService.stageAllAndCommitIfChanged({
        path: workingPath,
        message: `Apply ${templateId} template`,
      });
      if (commitHash === null) {
        logger.info(
          `Template ${templateId} already applied to app ${appId}, skipping commit`,
        );
        return { applied: false, needsRestart: appWasStopped };
      }

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

      return { applied: true, needsRestart: true };
    });
  });
}
