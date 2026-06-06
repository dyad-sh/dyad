import { db } from "../../db";
import { apps, chats, messages, versions } from "../../db/schema";
import { desc, eq, and, gt, gte } from "drizzle-orm";
import type { GitCommit } from "../git_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { versionContracts } from "../types/version";

import { deployAllSupabaseFunctions } from "../../supabase_admin/supabase_utils";
import { readSettings } from "../../main/settings";
import {
  gitCheckout,
  gitCommit,
  gitStageToRevert,
  getCurrentCommitHash,
  gitCommitExists,
  gitCurrentBranch,
  gitLog,
  isGitStatusClean,
  getChangedFilesForCommit,
  getFileAtCommit,
  getOldFileContent,
} from "../utils/git_utils";

import {
  getNeonClient,
  getNeonErrorMessage,
  getRetentionWindowFromError,
  isRetentionWindowError,
} from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import {
  updatePostgresUrlEnvVar,
  updateDbPushEnvVar,
} from "../utils/app_env_var_utils";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";
import { retryOnLocked } from "../utils/retryOnLocked";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { syncCloudSandboxSnapshot } from "../utils/cloud_sandbox_provider";
import {
  DIFF_BINARY_PLACEHOLDER,
  DIFF_TOO_LARGE_PLACEHOLDER,
} from "@/shared/diff_placeholders";

const logger = log.scope("version_handlers");

// Guard against dumping binary blobs or huge files into the renderer's diff
// editor. Binary files render as garbage and large files hurt performance.
const MAX_DIFF_CONTENT_BYTES = 1_000_000; // ~1 MB

function sanitizeDiffContent(content: string): string {
  // Size guard first: content.length is an O(1) check that short-circuits
  // oversized files before the O(N) NUL scan / byte-length traversal below.
  // Fast-path: every UTF-8 character is at least 1 byte, so if the string
  // length already exceeds the limit, the byte length must too — which lets us
  // skip the Buffer.byteLength traversal for large files entirely.
  if (
    content.length > MAX_DIFF_CONTENT_BYTES ||
    Buffer.byteLength(content, "utf-8") > MAX_DIFF_CONTENT_BYTES
  ) {
    return DIFF_TOO_LARGE_PLACEHOLDER;
  }
  // A NUL byte is a strong signal the file is binary.
  if (/\u0000/.test(content)) {
    return DIFF_BINARY_PLACEHOLDER;
  }
  return content;
}

/**
 * Builds a user-facing warning for when the code was restored but the Neon
 * database could not be. The retention-window case (the database snapshot is
 * older than Neon keeps history for, e.g. 6 hours on the free plan) gets a
 * dedicated explanation since it isn't an unexpected failure.
 */
function getDatabaseRestoreWarning(error: unknown): string {
  if (isRetentionWindowError(error)) {
    const window = getRetentionWindowFromError(error);
    return (
      "Restored your code to this version, but the database could not be restored: " +
      `this version is older than your database's restore window${
        window ? ` (${window})` : ""
      }. ` +
      "Neon's free plan only keeps a limited window of database history, so this " +
      "snapshot has expired. Your current database was left unchanged."
    );
  }
  return `Could not restore the database because of an error: ${getNeonErrorMessage(
    error,
  )}`;
}

async function syncCloudSandboxSnapshotBestEffort(appId: number) {
  try {
    await syncCloudSandboxSnapshot({ appId });
  } catch (error) {
    logger.warn(
      `Cloud sandbox sync failed after version operation for app ${appId}:`,
      error,
    );
  }
}

function normalizeVersionNote(note: string | null): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

async function getVersionAppPath(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  const appPath = getDyadAppPath(app.path);
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    throw new DyadError("Not a git repository", DyadErrorKind.External);
  }

  return appPath;
}

async function assertVersionExists({
  appPath,
  versionId,
}: {
  appPath: string;
  versionId: string;
}) {
  const exists = await gitCommitExists({
    path: appPath,
    commitHash: versionId,
  });
  if (!exists) {
    throw new DyadError("Version not found", DyadErrorKind.NotFound);
  }
}

async function upsertVersionMetadata({
  appId,
  versionId,
  isFavorite,
  note,
}: {
  appId: number;
  versionId: string;
  isFavorite?: boolean;
  note?: string | null;
}) {
  const appPath = await getVersionAppPath(appId);
  await assertVersionExists({ appPath, versionId });

  const normalizedNote =
    note === undefined ? undefined : normalizeVersionNote(note);

  const [versionMetadata] = await db
    .insert(versions)
    .values({
      appId,
      commitHash: versionId,
      // Insert means this is the first metadata touch for the version. For an
      // absent row, defaults for omitted fields preserve the intended baseline.
      isFavorite: isFavorite ?? false,
      note: normalizedNote ?? null,
    })
    .onConflictDoUpdate({
      target: [versions.appId, versions.commitHash],
      set: {
        ...(isFavorite === undefined ? {} : { isFavorite }),
        ...(normalizedNote === undefined ? {} : { note: normalizedNote }),
        updatedAt: new Date(),
      },
    })
    .returning({
      isFavorite: versions.isFavorite,
      note: versions.note,
    });

  return {
    oid: versionId,
    isFavorite: versionMetadata.isFavorite,
    note: versionMetadata.note,
  };
}

async function restoreBranchForPreview({
  appId,
  dbTimestamp,
  neonProjectId,
  previewBranchId,
  developmentBranchId,
}: {
  appId: number;
  dbTimestamp: string;
  neonProjectId: string;
  previewBranchId: string;
  developmentBranchId: string;
}): Promise<void> {
  const neonClient = await getNeonClient();
  await retryOnLocked(
    () =>
      neonClient.restoreProjectBranch(neonProjectId, previewBranchId, {
        source_branch_id: developmentBranchId,
        source_timestamp: dbTimestamp,
      }),
    `Restore preview branch ${previewBranchId} for app ${appId}`,
  );
}

/**
 * Reverts the app's codebase (and Neon DB / Supabase functions / cloud sandbox)
 * to the given version. This does NOT modify any chat messages and does NOT take
 * the per-app lock — callers are responsible for holding `withLock(appId)`.
 */
async function revertCodebaseToVersion({
  appId,
  app,
  appPath,
  previousVersionId,
  targetBranchName,
}: {
  appId: number;
  app: typeof apps.$inferSelect;
  appPath: string;
  previousVersionId: string;
  targetBranchName?: string;
}): Promise<{ successMessage: string; warningMessage: string }> {
  let successMessage = "Restored version";
  let warningMessage = "";

  const currentBranch = await gitCurrentBranch({ path: appPath });
  const revertRef = currentBranch ?? targetBranchName ?? "HEAD";
  // Get the current commit hash before reverting
  const currentCommitHash = await getCurrentCommitHash({
    path: appPath,
    ref: revertRef,
  });

  await gitCheckout({
    path: appPath,
    ref: revertRef,
  });

  if (app.neonProjectId && app.neonDevelopmentBranchId) {
    // We are going to add a new commit on top, so let's store
    // the current timestamp at the current version.
    await storeDbTimestampAtCurrentVersion({
      appId,
    });
  }

  await gitStageToRevert({
    path: appPath,
    targetOid: previousVersionId,
  });
  const isClean = await isGitStatusClean({ path: appPath });
  if (!isClean) {
    await gitCommit({
      path: appPath,
      message: `Reverted all changes back to version ${previousVersionId}`,
    });
  }

  if (app.neonProjectId && app.neonDevelopmentBranchId) {
    const version = await db.query.versions.findFirst({
      where: and(
        eq(versions.appId, appId),
        eq(versions.commitHash, previousVersionId),
      ),
    });
    if (version && version.neonDbTimestamp) {
      try {
        const preserveBranchName = `preserve_${currentCommitHash}-${Date.now()}`;
        const neonClient = await getNeonClient();
        const response = await retryOnLocked(
          () =>
            neonClient.restoreProjectBranch(
              app.neonProjectId!,
              app.neonDevelopmentBranchId!,
              {
                source_branch_id: app.neonDevelopmentBranchId!,
                source_timestamp: version.neonDbTimestamp!,
                preserve_under_name: preserveBranchName,
              },
            ),
          `Restore development branch ${app.neonDevelopmentBranchId} for app ${appId}`,
        );
        // Update all versions which have a newer DB timestamp than the version we're restoring to
        // and remove their DB timestamp.
        await db
          .update(versions)
          .set({ neonDbTimestamp: null })
          .where(
            and(
              eq(versions.appId, appId),
              gt(versions.neonDbTimestamp, version.neonDbTimestamp),
            ),
          );

        const preserveBranchId = response.data.branch.parent_id;
        if (!preserveBranchId) {
          throw new DyadError(
            "Preserve branch ID not found",
            DyadErrorKind.NotFound,
          );
        }
        logger.info(
          `Deleting preserve branch ${preserveBranchId} for app ${appId}`,
        );
        // Intentionally do not await this because it's not
        // critical for the restore operation, it's to clean up branches
        // so the user doesn't hit the branch limit later. The error is
        // handled via `.catch()` rather than a surrounding try/catch
        // because, without an `await`, a try/catch would not catch the
        // promise rejection and it would surface as an unhandled rejection.
        retryOnLocked(
          () =>
            neonClient.deleteProjectBranch(
              app.neonProjectId!,
              preserveBranchId,
            ),
          `Delete preserve branch ${preserveBranchId} for app ${appId}`,
          { retryBranchWithChildError: true },
        ).catch((error) => {
          const errorMessage = getNeonErrorMessage(error);
          logger.error("Error in deleteProjectBranch:", errorMessage);
        });
      } catch (error) {
        const errorMessage = getNeonErrorMessage(error);
        logger.error("Error in restoreBranchForCheckout:", errorMessage);
        warningMessage = `Could not restore database because of error: ${errorMessage}`;
        // Do not throw, so we can finish switching the postgres branch
        // It might throw because they picked a timestamp that's too old.
      }
      successMessage = "Successfully restored to version (including database)";
    }
    await switchPostgresToDevelopmentBranch({
      neonProjectId: app.neonProjectId,
      neonDevelopmentBranchId: app.neonDevelopmentBranchId,
      appPath: app.path,
    });
  }
  // Re-deploy all Supabase edge functions after reverting
  if (app.supabaseProjectId) {
    try {
      logger.info(
        `Re-deploying all Supabase edge functions for app ${appId} after revert`,
      );
      const settings = readSettings();
      const deployErrors = await deployAllSupabaseFunctions({
        appPath,
        supabaseProjectId: app.supabaseProjectId,
        supabaseOrganizationSlug: app.supabaseOrganizationSlug ?? null,
        skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
      });

      if (deployErrors.length > 0) {
        warningMessage += `Some Supabase functions failed to deploy after revert: ${deployErrors.join(", ")}`;
        logger.warn(warningMessage);
        // Note: We don't fail the revert operation if function deployment fails
        // The code has been successfully reverted, but functions may be out of sync
      } else {
        logger.info(
          `Successfully re-deployed all Supabase edge functions for app ${appId}`,
        );
      }
    } catch (error) {
      warningMessage += `Error re-deploying Supabase edge functions after revert: ${error}`;
      logger.warn(warningMessage);
      // Continue with the revert operation even if function deployment fails
    }
  }
  await syncCloudSandboxSnapshotBestEffort(appId);

  return { successMessage, warningMessage };
}

export function registerVersionHandlers() {
  createTypedHandler(versionContracts.listVersions, async (_, params) => {
    const { appId } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      // The app might have just been deleted, so we return an empty array.
      return [];
    }

    const appPath = getDyadAppPath(app.path);

    // Just return an empty array if the app is not a git repo.
    if (!fs.existsSync(path.join(appPath, ".git"))) {
      return [];
    }

    const commits = await gitLog({
      path: appPath,
      depth: 100_000, // KEEP UP TO DATE WITH ChatHeader.tsx
    });

    // Get all stored version metadata for this app to match with commits.
    const appVersionMetadata = await db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });

    // Create a map of commitHash -> version metadata for quick lookup.
    const metadataMap = new Map<
      string,
      {
        neonDbTimestamp: string | null;
        isFavorite: boolean;
        note: string | null;
      }
    >();
    for (const metadata of appVersionMetadata) {
      metadataMap.set(metadata.commitHash, {
        neonDbTimestamp: metadata.neonDbTimestamp,
        isFavorite: metadata.isFavorite,
        note: metadata.note,
      });
    }

    return commits.map((commit: GitCommit) => {
      const metadata = metadataMap.get(commit.oid);
      return {
        oid: commit.oid,
        message: commit.commit.message,
        timestamp: commit.commit.author.timestamp,
        dbTimestamp: metadata?.neonDbTimestamp,
        isFavorite: metadata?.isFavorite ?? false,
        note: metadata?.note ?? null,
      };
    });
  });

  createTypedHandler(versionContracts.setVersionFavorite, async (_, params) => {
    const { appId, versionId, isFavorite } = params;
    return upsertVersionMetadata({ appId, versionId, isFavorite });
  });

  createTypedHandler(versionContracts.setVersionNote, async (_, params) => {
    const { appId, versionId, note } = params;
    return upsertVersionMetadata({ appId, versionId, note });
  });

  createTypedHandler(versionContracts.getCurrentBranch, async (_, params) => {
    const { appId } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    const appPath = getDyadAppPath(app.path);

    // Return appropriate result if the app is not a git repo
    if (!fs.existsSync(path.join(appPath, ".git"))) {
      throw new DyadError("Not a git repository", DyadErrorKind.External);
    }

    try {
      const currentBranch = await gitCurrentBranch({ path: appPath });

      return {
        branch: currentBranch || "<no-branch>",
      };
    } catch (error: any) {
      logger.error(`Error getting current branch for app ${appId}:`, error);
      throw new DyadError(
        `Failed to get current branch: ${error.message}`,
        DyadErrorKind.External,
      );
    }
  });

  createTypedHandler(versionContracts.getVersionChanges, async (_, params) => {
    const { appId, versionId } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    const appPath = getDyadAppPath(app.path);

    if (!fs.existsSync(path.join(appPath, ".git"))) {
      throw new DyadError("Not a git repository", DyadErrorKind.External);
    }

    try {
      const changedFiles = await getChangedFilesForCommit({
        path: appPath,
        commitHash: versionId,
      });

      const loadFileChange = async (file: (typeof changedFiles)[number]) => {
        const newContent =
          file.type === "deleted"
            ? ""
            : ((await getFileAtCommit({
                path: appPath,
                filePath: file.path,
                commitHash: versionId,
              })) ?? "");
        const oldContent =
          file.type === "added"
            ? ""
            : ((await getOldFileContent({
                path: appPath,
                filePath: file.path,
                commitHash: versionId,
              })) ?? "");
        return {
          path: file.path,
          type: file.type,
          oldContent: sanitizeDiffContent(oldContent),
          newContent: sanitizeDiffContent(newContent),
        };
      };

      // Each file may spawn up to two git child processes (native git). Bound
      // the concurrency so commits touching many files (e.g. an initial commit
      // of a generated app) don't exhaust file descriptors.
      const CONCURRENCY = 10;
      const results: Awaited<ReturnType<typeof loadFileChange>>[] = [];
      for (let i = 0; i < changedFiles.length; i += CONCURRENCY) {
        const batch = changedFiles.slice(i, i + CONCURRENCY);
        results.push(...(await Promise.all(batch.map(loadFileChange))));
      }
      return results;
    } catch (error: any) {
      // Preserve the original error kind for DyadErrors thrown by inner
      // functions; only wrap unexpected (non-Dyad) failures as External.
      if (error instanceof DyadError) {
        throw error;
      }
      logger.error(
        `Error getting version changes for app ${appId} version ${versionId}:`,
        error,
      );
      throw new DyadError(
        `Failed to get version changes: ${error.message}`,
        DyadErrorKind.External,
      );
    }
  });

  createTypedHandler(versionContracts.revertVersion, async (_, params) => {
    const { appId, previousVersionId, currentChatMessageId, targetBranchName } =
      params;
    return withLock(appId, async () => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      const appPath = getDyadAppPath(app.path);

      const { successMessage, warningMessage } = await revertCodebaseToVersion({
        appId,
        app,
        appPath,
        previousVersionId,
        targetBranchName,
      });

      // Delete messages based on currentChatMessageId if provided, otherwise use commit hash lookup
      if (currentChatMessageId) {
        // Delete all messages including and after the specified message
        const { chatId, messageId } = currentChatMessageId;

        const messagesToDelete = await db.query.messages.findMany({
          where: and(eq(messages.chatId, chatId), gte(messages.id, messageId)),
          orderBy: desc(messages.id),
        });

        logger.log(
          `Deleting ${messagesToDelete.length} messages (id >= ${messageId}) from chat ${chatId}`,
        );

        if (messagesToDelete.length > 0) {
          await db
            .delete(messages)
            .where(
              and(eq(messages.chatId, chatId), gte(messages.id, messageId)),
            );
        }
      } else {
        // Find the chat and message associated with the commit hash
        const messageWithCommit = await db.query.messages.findFirst({
          where: eq(messages.commitHash, previousVersionId),
          with: {
            chat: true,
          },
        });

        // If we found a message with this commit hash, delete all subsequent messages (but keep this message)
        if (messageWithCommit) {
          const chatId = messageWithCommit.chatId;

          // Find all messages in this chat with IDs > the one with our commit hash
          const messagesToDelete = await db.query.messages.findMany({
            where: and(
              eq(messages.chatId, chatId),
              gt(messages.id, messageWithCommit.id),
            ),
            orderBy: desc(messages.id),
          });

          logger.log(
            `Deleting ${messagesToDelete.length} messages after commit ${previousVersionId} from chat ${chatId}`,
          );

          // Delete the messages
          if (messagesToDelete.length > 0) {
            await db
              .delete(messages)
              .where(
                and(
                  eq(messages.chatId, chatId),
                  gt(messages.id, messageWithCommit.id),
                ),
              );
          }
        }
      }

      if (app.neonProjectId && app.neonDevelopmentBranchId) {
        const version = await db.query.versions.findFirst({
          where: and(
            eq(versions.appId, appId),
            eq(versions.commitHash, previousVersionId),
          ),
        });
        if (version && version.neonDbTimestamp) {
          try {
            const preserveBranchName = `preserve_${currentCommitHash}-${Date.now()}`;
            const neonClient = await getNeonClient();
            const response = await retryOnLocked(
              () =>
                neonClient.restoreProjectBranch(
                  app.neonProjectId!,
                  app.neonDevelopmentBranchId!,
                  {
                    source_branch_id: app.neonDevelopmentBranchId!,
                    source_timestamp: version.neonDbTimestamp!,
                    preserve_under_name: preserveBranchName,
                  },
                ),
              `Restore development branch ${app.neonDevelopmentBranchId} for app ${appId}`,
            );
            // Update all versions which have a newer DB timestamp than the version we're restoring to
            // and remove their DB timestamp.
            await db
              .update(versions)
              .set({ neonDbTimestamp: null })
              .where(
                and(
                  eq(versions.appId, appId),
                  gt(versions.neonDbTimestamp, version.neonDbTimestamp),
                ),
              );

            const preserveBranchId = response.data.branch.parent_id;
            if (!preserveBranchId) {
              throw new DyadError(
                "Preserve branch ID not found",
                DyadErrorKind.NotFound,
              );
            }
            logger.info(
              `Deleting preserve branch ${preserveBranchId} for app ${appId}`,
            );
            try {
              // Intentionally do not await this because it's not
              // critical for the restore operation, it's to clean up branches
              // so the user doesn't hit the branch limit later.
              retryOnLocked(
                () =>
                  neonClient.deleteProjectBranch(
                    app.neonProjectId!,
                    preserveBranchId,
                  ),
                `Delete preserve branch ${preserveBranchId} for app ${appId}`,
                { retryBranchWithChildError: true },
              );
            } catch (error) {
              const errorMessage = getNeonErrorMessage(error);
              logger.error("Error in deleteProjectBranch:", errorMessage);
            }
            successMessage =
              "Successfully restored to version (including database)";
          } catch (error) {
            logger.error(
              "Error restoring Neon development branch during revert:",
              getNeonErrorMessage(error),
            );
            // Do not throw: the code has already been reverted, so we keep the
            // current database, warn the user, and finish switching the
            // postgres branch. This commonly happens when the picked version is
            // older than Neon's retention window.
            warningMessage = getDatabaseRestoreWarning(error);
          }
        }
        await switchPostgresToDevelopmentBranch({
          neonProjectId: app.neonProjectId,
          neonDevelopmentBranchId: app.neonDevelopmentBranchId,
          appPath: app.path,
        });
      }
      // Re-deploy all Supabase edge functions after reverting
      if (app.supabaseProjectId) {
        try {
          logger.info(
            `Re-deploying all Supabase edge functions for app ${appId} after revert`,
          );
          const settings = readSettings();
          const deployErrors = await deployAllSupabaseFunctions({
            appPath,
            supabaseProjectId: app.supabaseProjectId,
            supabaseOrganizationSlug: app.supabaseOrganizationSlug ?? null,
            skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
          });

          if (deployErrors.length > 0) {
            warningMessage += `Some Supabase functions failed to deploy after revert: ${deployErrors.join(", ")}`;
            logger.warn(warningMessage);
            // Note: We don't fail the revert operation if function deployment fails
            // The code has been successfully reverted, but functions may be out of sync
          } else {
            logger.info(
              `Successfully re-deployed all Supabase edge functions for app ${appId}`,
            );
          }
        } catch (error) {
          warningMessage += `Error re-deploying Supabase edge functions after revert: ${error}`;
          logger.warn(warningMessage);
          // Continue with the revert operation even if function deployment fails
        }
      }
      await syncCloudSandboxSnapshotBestEffort(appId);
      if (warningMessage) {
        return { warningMessage };
      }
      return { successMessage };
    });
  });

  createTypedHandler(
    versionContracts.restoreToMessageVersion,
    async (_, params) => {
      const { appId, chatId, messageId } = params;
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        const appPath = getDyadAppPath(app.path);

        const chat = await db.query.chats.findFirst({
          where: eq(chats.id, chatId),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [
                asc(messages.createdAt),
                asc(messages.id),
              ],
            },
          },
        });
        if (!chat) {
          throw new DyadError("Chat not found", DyadErrorKind.NotFound);
        }
        // Defense in depth: make sure the chat actually belongs to this app so
        // a mismatched (appId, chatId) from the renderer can't create a chat
        // under the wrong app or revert to a commit from another app's repo.
        if (chat.appId !== appId) {
          throw new DyadError(
            "Chat does not belong to this app",
            DyadErrorKind.Validation,
          );
        }

        const targetIndex = chat.messages.findIndex((m) => m.id === messageId);
        if (targetIndex === -1) {
          throw new DyadError("Message not found", DyadErrorKind.NotFound);
        }

        const messagesBefore = chat.messages.slice(0, targetIndex);

        // Determine the version that existed right before the target message.
        // Primary signal: the assistant message that responded to the target
        // user message stores `sourceCommitHash` = the commit current when that
        // turn started (i.e. before its code changes).
        const followingMessage = chat.messages[targetIndex + 1];
        let targetCommitHash: string | null =
          followingMessage?.role === "assistant"
            ? (followingMessage.sourceCommitHash ?? null)
            : null;
        // Fallback: the assistant message preceding the target user message
        // stores `commitHash` = the version that existed when it finished, which
        // is the state right before the target message was sent.
        if (!targetCommitHash) {
          for (let i = targetIndex - 1; i >= 0; i--) {
            const m = chat.messages[i];
            if (m.role === "assistant" && m.commitHash) {
              targetCommitHash = m.commitHash;
              break;
            }
          }
        }
        // Final fallback: the commit the chat started from.
        if (!targetCommitHash) {
          targetCommitHash = chat.initialCommitHash ?? null;
        }

        if (!targetCommitHash) {
          // No version could be determined, so we don't create a new chat.
          // Omit `newChatId` so the renderer stays on the current chat instead
          // of "navigating" to the same one (which would look like a no-op).
          return {
            warningMessage:
              "Could not determine a version to restore to for this message.",
          };
        }

        // Revert the codebase first. If this throws (e.g. a Git or Neon
        // error), we bail out before touching the database so we don't leave
        // an orphaned, partially-created chat behind. A `warningMessage` still
        // means the codebase was reverted (only a secondary step failed), so
        // we go on to create the new chat in that case.
        const { successMessage, warningMessage } =
          await revertCodebaseToVersion({
            appId,
            app,
            appPath,
            previousVersionId: targetCommitHash,
          });

        // Carry over the original chat's title (with a suffix) so the forked
        // chat is identifiable in the sidebar instead of showing up as another
        // indistinguishable "untitled" entry after one or more restores.
        const restoredTitle = chat.title ? `${chat.title} (restored)` : null;

        // Create the new chat pointing at the target version. We insert directly
        // (instead of using the createChat handler) so `initialCommitHash` is the
        // target version rather than the current (not-yet-reverted) tree.
        const [newChat] = await db
          .insert(chats)
          .values({
            appId,
            title: restoredTitle,
            chatMode: chat.chatMode,
            initialCommitHash: targetCommitHash,
          })
          .returning();

        // Copy all messages that came before the target message into the new
        // chat, preserving their fields and ordering.
        if (messagesBefore.length > 0) {
          await db.insert(messages).values(
            messagesBefore.map((m) => ({
              chatId: newChat.id,
              role: m.role,
              content: m.content,
              approvalState: m.approvalState,
              sourceCommitHash: m.sourceCommitHash,
              commitHash: m.commitHash,
              requestId: m.requestId,
              maxTokensUsed: m.maxTokensUsed,
              model: m.model,
              aiMessagesJson: m.aiMessagesJson,
              usingFreeAgentModeQuota: m.usingFreeAgentModeQuota,
              isCompactionSummary: m.isCompactionSummary,
              createdAt: m.createdAt,
            })),
          );
        }

        if (warningMessage) {
          return { newChatId: newChat.id, warningMessage };
        }
        return { newChatId: newChat.id, successMessage };
      });
    },
  );

  createTypedHandler(versionContracts.checkoutVersion, async (_, params) => {
    const { appId, versionId: gitRef } = params;
    return withLock(appId, async () => {
      let warningMessage = "";
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      if (
        app.neonProjectId &&
        app.neonDevelopmentBranchId &&
        app.neonPreviewBranchId
      ) {
        if (gitRef === "main") {
          logger.info(
            `Switching Postgres to development branch for app ${appId}`,
          );
          await switchPostgresToDevelopmentBranch({
            neonProjectId: app.neonProjectId,
            neonDevelopmentBranchId: app.neonDevelopmentBranchId,
            appPath: app.path,
          });
        } else {
          logger.info(`Switching Postgres to preview branch for app ${appId}`);

          // Regardless of whether we have a timestamp or not, we want to disable DB push
          // while we're checking out an earlier version
          await updateDbPushEnvVar({
            appPath: app.path,
            disabled: true,
          });

          const version = await db.query.versions.findFirst({
            where: and(
              eq(versions.appId, appId),
              eq(versions.commitHash, gitRef),
            ),
          });

          if (version && version.neonDbTimestamp) {
            try {
              // SWITCH the env var for POSTGRES_URL to the preview branch
              const connectionUri = await getConnectionUri({
                projectId: app.neonProjectId,
                branchId: app.neonPreviewBranchId,
              });

              await restoreBranchForPreview({
                appId,
                dbTimestamp: version.neonDbTimestamp,
                neonProjectId: app.neonProjectId,
                previewBranchId: app.neonPreviewBranchId,
                developmentBranchId: app.neonDevelopmentBranchId,
              });

              await updatePostgresUrlEnvVar({
                appPath: app.path,
                connectionUri,
              });
              logger.info(
                `Switched Postgres to preview branch for app ${appId} commit ${version.commitHash} dbTimestamp=${version.neonDbTimestamp}`,
              );
            } catch (error) {
              logger.error(
                "Error restoring Neon preview branch during checkout:",
                getNeonErrorMessage(error),
              );
              // Do not throw: we still want to check out the code below. This
              // commonly happens when the picked version is older than Neon's
              // retention window, so the database snapshot has expired.
              warningMessage = getDatabaseRestoreWarning(error);
              // Keep the app pointed at the live development database so the
              // checked-out code still has a database to run against. This is
              // best-effort and must never block the code checkout.
              try {
                await updatePostgresUrlEnvVar({
                  appPath: app.path,
                  connectionUri: await getConnectionUri({
                    projectId: app.neonProjectId,
                    branchId: app.neonDevelopmentBranchId,
                  }),
                });
              } catch (fallbackError) {
                logger.error(
                  "Failed to point Postgres at the development branch after a failed preview restore:",
                  getNeonErrorMessage(fallbackError),
                );
                // The fallback failed too, so we could not explicitly re-point
                // the app at the development branch. The env file is left at its
                // previous value, which is usually still the development branch
                // but may be a stale preview branch from an earlier checkout.
                // Overwrite the warning so the user knows the DB branch is
                // uncertain.
                warningMessage =
                  "Restored your code to this version, but the database could not be " +
                  "switched and we were unable to confirm which database branch your app " +
                  `is connected to: ${getNeonErrorMessage(fallbackError)}. Please check ` +
                  "your app's database connection before relying on its data.";
              }
            }
          }
        }
      }
      const fullAppPath = getDyadAppPath(app.path);
      await gitCheckout({
        path: fullAppPath,
        ref: gitRef,
      });
      await syncCloudSandboxSnapshotBestEffort(appId);
      if (warningMessage) {
        return { warningMessage };
      }
      return {};
    });
  });
}

async function switchPostgresToDevelopmentBranch({
  neonProjectId,
  neonDevelopmentBranchId,
  appPath,
}: {
  neonProjectId: string;
  neonDevelopmentBranchId: string;
  appPath: string;
}) {
  // SWITCH the env var for POSTGRES_URL to the development branch
  const connectionUri = await getConnectionUri({
    projectId: neonProjectId,
    branchId: neonDevelopmentBranchId,
  });

  await updatePostgresUrlEnvVar({
    appPath,
    connectionUri,
  });

  await updateDbPushEnvVar({
    appPath,
    disabled: false,
  });
}
