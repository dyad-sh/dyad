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
  gitAddAll,
  gitCheckout,
  gitCommit,
  gitStageToRevert,
  getCurrentCommitHash,
  gitCurrentBranch,
  gitLog,
  isGitStatusClean,
} from "../utils/git_utils";

import {
  getNeonClient,
  getNeonErrorMessage,
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

const logger = log.scope("version_handlers");

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
  try {
    const neonClient = await getNeonClient();
    await retryOnLocked(
      () =>
        neonClient.restoreProjectBranch(neonProjectId, previewBranchId, {
          source_branch_id: developmentBranchId,
          source_timestamp: dbTimestamp,
        }),
      `Restore preview branch ${previewBranchId} for app ${appId}`,
    );
  } catch (error) {
    const errorMessage = getNeonErrorMessage(error);
    logger.error("Error in restoreBranchForPreview:", errorMessage);
    throw new Error(errorMessage);
  }
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
}: {
  appId: number;
  app: typeof apps.$inferSelect;
  appPath: string;
  previousVersionId: string;
}): Promise<{ successMessage: string; warningMessage: string }> {
  let successMessage = "Restored version";
  let warningMessage = "";

  // Get the current commit hash before reverting
  const currentCommitHash = await getCurrentCommitHash({
    path: appPath,
    ref: "main",
  });

  await gitCheckout({
    path: appPath,
    ref: "main",
  });

  // A cancelled/aborted stream leaves the AI's partial file writes uncommitted
  // in the working tree (`cancelStream` only aborts; it never commits). That
  // would make `gitStageToRevert` refuse to run ("working tree has uncommitted
  // changes"). Commit those pending changes first so they're preserved as a
  // version (consistent with Dyad's one-commit-per-turn model) and the revert
  // can proceed against a clean tree. This must run before
  // `storeDbTimestampAtCurrentVersion` so the Neon timestamp binds to the
  // committed state rather than the soon-to-be-discarded dirty tree.
  if (!(await isGitStatusClean({ path: appPath }))) {
    // Stage everything first so untracked files (e.g. a newly added
    // pnpm-workspace.yaml) are included. With native git, `git commit` only
    // commits staged changes, so without this the commit would fail with
    // "nothing added to commit but untracked files present" and the revert
    // would abort.
    await gitAddAll({ path: appPath });
    await gitCommit({
      path: appPath,
      message:
        "Saved uncommitted changes before restoring to an earlier version",
    });
  }

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
        // Only claim the database was included when the restore actually
        // succeeded. Setting this after the catch would wrongly report
        // "(including database)" even when the Neon restore failed and
        // `warningMessage` was set.
        successMessage =
          "Successfully restored to version (including database)";
      } catch (error) {
        const errorMessage = getNeonErrorMessage(error);
        logger.error("Error in restoreBranchForCheckout:", errorMessage);
        warningMessage = `Could not restore database because of error: ${errorMessage}`;
        // Do not throw, so we can finish switching the postgres branch
        // It might throw because they picked a timestamp that's too old.
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

    // Get all snapshots for this app to match with commits
    const appSnapshots = await db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });

    // Create a map of commitHash -> snapshot info for quick lookup
    const snapshotMap = new Map<
      string,
      { neonDbTimestamp: string | null; createdAt: Date }
    >();
    for (const snapshot of appSnapshots) {
      snapshotMap.set(snapshot.commitHash, {
        neonDbTimestamp: snapshot.neonDbTimestamp,
        createdAt: snapshot.createdAt,
      });
    }

    return commits.map((commit: GitCommit) => {
      const snapshotInfo = snapshotMap.get(commit.oid);
      return {
        oid: commit.oid,
        message: commit.commit.message,
        timestamp: commit.commit.author.timestamp,
        dbTimestamp: snapshotInfo?.neonDbTimestamp,
      };
    });
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

  createTypedHandler(versionContracts.revertVersion, async (_, params) => {
    const { appId, previousVersionId, currentChatMessageId } = params;
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
        // turn started (i.e. before its code changes). Walk forward past any
        // intervening user messages (e.g. consecutive prompts or compaction
        // summaries) to find that responding assistant message.
        let targetCommitHash: string | null = null;
        for (let i = targetIndex + 1; i < chat.messages.length; i++) {
          const m = chat.messages[i];
          if (m.role === "assistant") {
            targetCommitHash = m.sourceCommitHash ?? null;
            break;
          }
        }
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
        // indistinguishable "untitled" entry after one or more restores. When
        // the original is untitled we still apply a bare "(restored)" label so
        // the fork isn't rendered as a generic "New Chat" entry.
        const restoredTitle = chat.title
          ? `${chat.title} (restored)`
          : "(restored)";

        // Create the new chat pointing at the target version and copy over the
        // earlier messages atomically. We insert directly (instead of using the
        // createChat handler) so `initialCommitHash` is the target version
        // rather than the current (not-yet-reverted) tree. Wrapping both inserts
        // in a transaction ensures we never leave behind an orphaned, empty
        // "(restored)" chat if the messages insert fails after the chat insert.
        // better-sqlite3 transactions are synchronous, so the callback uses the
        // sync query API (`.get()`/`.run()`) rather than `await`.
        const newChat = db.transaction((tx) => {
          const createdChat = tx
            .insert(chats)
            .values({
              appId,
              title: restoredTitle,
              chatMode: chat.chatMode,
              initialCommitHash: targetCommitHash,
            })
            .returning()
            .get();

          // Copy all messages that came before the target message into the new
          // chat, preserving their fields and ordering.
          if (messagesBefore.length > 0) {
            tx.insert(messages)
              .values(
                messagesBefore.map((m) => ({
                  chatId: createdChat.id,
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
              )
              .run();
          }

          return createdChat;
        });

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
          }
        }
      }
      const fullAppPath = getDyadAppPath(app.path);
      await gitCheckout({
        path: fullAppPath,
        ref: gitRef,
      });
      await syncCloudSandboxSnapshotBestEffort(appId);
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
