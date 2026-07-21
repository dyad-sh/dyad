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
  getGitUncommittedFilesWithStatus,
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
import {
  blockNewStreamsForApp,
  blockNewStreamsForChat,
  cancelActiveStreamsForApp,
} from "./chat_stream_handlers";

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

function appendWarning(existing: string, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

const INTERRUPTED_GENERATION_WARNING =
  "An in-progress generation was cancelled during this restore attempt. Re-submit its prompt to continue.";

function versionRuntimeAction(
  app: typeof apps.$inferSelect,
  changedCodebase: boolean,
): "none" | "restart" {
  if (!changedCodebase) return "none";
  return readSettings().runtimeMode2 === "cloud" || app.neonProjectId
    ? "restart"
    : "none";
}

function versionCommandResult({
  repositoryOutcome = "target-applied",
  notification = null,
  runtimeAction = "none",
  affectedChatId = null,
  createdChatId = null,
}: {
  repositoryOutcome?: "target-applied" | "unchanged";
  notification?: {
    kind: "success" | "warning";
    message: string;
  } | null;
  runtimeAction?: "none" | "restart";
  affectedChatId?: number | null;
  createdChatId?: number | null;
}) {
  return {
    repositoryOutcome,
    notification,
    runtimeAction,
    affectedChatId,
    createdChatId,
  };
}

function appendInterruptedGenerationWarning(
  warningMessage: string,
  didCancelStreams: boolean,
): string {
  return didCancelStreams
    ? appendWarning(warningMessage, INTERRUPTED_GENERATION_WARNING)
    : warningMessage;
}

type RestoreMessageCommitMetadata = Pick<
  typeof messages.$inferSelect,
  "role" | "sourceCommitHash" | "commitHash"
>;

function resolveTargetCommitHash({
  chatMessages,
  targetIndex,
  initialCommitHash,
}: {
  chatMessages: RestoreMessageCommitMetadata[];
  targetIndex: number;
  initialCommitHash: string | null;
}): string | null {
  // Primary signal: the assistant response stores the commit that was current
  // when the target turn started.
  for (let index = targetIndex + 1; index < chatMessages.length; index++) {
    const message = chatMessages[index];
    if (message.role === "assistant") {
      if (message.sourceCommitHash) {
        return message.sourceCommitHash;
      }
      break;
    }
  }

  // Fallback: the preceding assistant's final commit is the state immediately
  // before the target user message.
  for (let index = targetIndex - 1; index >= 0; index--) {
    const message = chatMessages[index];
    if (message.role === "assistant" && message.commitHash) {
      return message.commitHash;
    }
  }

  return initialCommitHash;
}

async function resolveRestoreRef({
  appPath,
  targetBranchName,
}: {
  appPath: string;
  targetBranchName?: string;
}): Promise<{
  currentBranch: string | null;
  revertRef: string;
  currentCommitHash: string;
}> {
  const currentBranch = await gitCurrentBranch({ path: appPath });
  if (!currentBranch && !targetBranchName) {
    throw new DyadError(
      "Cannot restore while viewing a historical version. Close the version " +
        "preview to return to your branch, then try again.",
      DyadErrorKind.Conflict,
    );
  }
  const revertRef = currentBranch ?? targetBranchName!;
  const currentCommitHash = await getCurrentCommitHash({
    path: appPath,
    ref: revertRef,
  });
  return { currentBranch, revertRef, currentCommitHash };
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
  preserveDirtyTree = false,
}: {
  appId: number;
  app: typeof apps.$inferSelect;
  appPath: string;
  previousVersionId: string;
  targetBranchName?: string;
  preserveDirtyTree?: boolean;
}): Promise<{ successMessage: string; warningMessage: string }> {
  let successMessage = "Restored version";
  let warningMessage = "";

  const { currentBranch, revertRef, currentCommitHash } =
    await resolveRestoreRef({
      appPath,
      targetBranchName,
    });
  // Detached HEAD (e.g. the Version pane has a historical version checked out)
  // has no branch to anchor the revert commit to. Callers that legitimately
  // operate while detached (the Version-pane restore) pass an explicit
  // `targetBranchName` so the commit lands on the live branch. Without one, the
  // revert commit would be created on the detached HEAD and then abandoned when
  // the saved branch is checked out again, silently discarding the restore. Bail
  // out with a clear message instead of doing the work only to throw it away.
  // A stream cancelled specifically for restore-to-message may leave partial
  // writes behind. Preserve that interrupted turn before reverting. Existing
  // Restore, Undo, Retry, and checkout paths intentionally keep their prior
  // dirty-tree conflict behavior instead of silently committing manual edits.
  let detachedCheckpointCommit: string | null = null;
  if (preserveDirtyTree && !(await isGitStatusClean({ path: appPath }))) {
    // Stage everything first so untracked files (e.g. a newly added
    // pnpm-workspace.yaml) are included. With native git, `git commit` only
    // commits staged changes, so without this the commit would fail with
    // "nothing added to commit but untracked files present" and the revert
    // would abort.
    //
    // We commit the whole dirty tree (rather than only stream-written files)
    // because the interrupted turn's writes cannot be reliably distinguished
    // from any pre-existing edits. This never loses work: the changes are
    // captured in a recoverable checkpoint commit that stays in history between
    // the target version and the revert commit, so the user can get back to it
    // via the Version pane. Log exactly what was captured so the side effect is
    // transparent rather than silent.
    const preservedFiles = await getGitUncommittedFilesWithStatus({
      path: appPath,
    });
    const preservedUserVisibleFiles = preservedFiles
      .map((f) => `${f.status} ${f.path}`)
      .join(", ");
    logger.log(
      `Preserving dirty tree in a checkpoint commit before restoring app ${appId}. ` +
        `User-visible uncommitted file(s): ${preservedFiles.length}` +
        (preservedUserVisibleFiles ? ` (${preservedUserVisibleFiles})` : "") +
        ". Dyad-managed runtime files may also be included in the checkpoint.",
    );
    await gitAddAll({ path: appPath });
    const checkpointCommit = await gitCommit({
      path: appPath,
      message:
        "Saved partial changes (from an interrupted generation) before restoring to an earlier version",
    });
    if (!currentBranch) {
      detachedCheckpointCommit = checkpointCommit;
    }
  }

  await gitCheckout({
    path: appPath,
    ref: revertRef,
  });

  // When the interrupted writes were checkpointed from a detached historical
  // preview, carry that exact tree onto the live branch before restoring. This
  // keeps the checkpoint discoverable in Version History and avoids asking Git
  // to checkout the branch over conflicting dirty files.
  if (detachedCheckpointCommit) {
    const hasStagedCheckpointChanges = await gitStageToRevert({
      path: appPath,
      targetOid: detachedCheckpointCommit,
    });
    if (hasStagedCheckpointChanges) {
      await gitCommit({
        path: appPath,
        message:
          "Saved partial changes (from an interrupted generation) before restoring to an earlier version",
      });
    }
  }

  if (app.neonProjectId && app.neonDevelopmentBranchId) {
    // We are going to add a new commit on top, so let's store
    // the current timestamp at the current version.
    await storeDbTimestampAtCurrentVersion({
      appId,
    });
  }

  const hasStagedRevertChanges = await gitStageToRevert({
    path: appPath,
    targetOid: previousVersionId,
  });
  if (hasStagedRevertChanges) {
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
        logger.error(
          "Error restoring Neon development branch during revert:",
          getNeonErrorMessage(error),
        );
        // Use the shared helper so the retention-window case gets its
        // user-friendly explanation instead of a raw error string.
        warningMessage = getDatabaseRestoreWarning(error);
        // Do not throw, so we can finish switching the postgres branch
        // It might throw because they picked a timestamp that's too old.
      }
    }
    try {
      await switchPostgresToDevelopmentBranch({
        neonProjectId: app.neonProjectId,
        neonDevelopmentBranchId: app.neonDevelopmentBranchId,
        appPath: app.path,
      });
    } catch (error) {
      // The git revert has already been committed at this point, so throwing
      // here would leave the code restored while the caller (revertVersion /
      // restore-to-message) skips its chat-state updates and reports failure.
      // Surface this as a warning so the restore still completes; only pointing
      // the app at the development database failed.
      logger.error(
        "Error switching Postgres to the development branch after revert:",
        getNeonErrorMessage(error),
      );
      warningMessage = appendWarning(
        warningMessage,
        "Restored your code to this version, but could not switch the app's " +
          `database connection back to the development branch: ${getNeonErrorMessage(
            error,
          )}. Please check your app's database connection before relying on its data.`,
      );
    }
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
        warningMessage = appendWarning(
          warningMessage,
          `Some Supabase functions failed to deploy after revert: ${deployErrors.join(", ")}`,
        );
        logger.warn(warningMessage);
        // Note: We don't fail the revert operation if function deployment fails
        // The code has been successfully reverted, but functions may be out of sync
      } else {
        logger.info(
          `Successfully re-deployed all Supabase edge functions for app ${appId}`,
        );
      }
    } catch (error) {
      warningMessage = appendWarning(
        warningMessage,
        `Error re-deploying Supabase edge functions after revert: ${error}`,
      );
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

      let affectedChatId: number | null = null;

      // Delete messages based on currentChatMessageId if provided, otherwise use commit hash lookup
      if (currentChatMessageId) {
        // Delete all messages including and after the specified message
        const { chatId, messageId } = currentChatMessageId;
        affectedChatId = chatId;

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
          affectedChatId = chatId;

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

      return versionCommandResult({
        notification: warningMessage
          ? { kind: "warning", message: warningMessage }
          : { kind: "success", message: successMessage },
        runtimeAction: versionRuntimeAction(app, true),
        affectedChatId,
      });
    });
  });

  createTypedHandler(
    versionContracts.restoreToMessageVersion,
    async (event, params) => {
      const {
        appId,
        chatId,
        messageId,
        restoreCodebase = true,
        targetBranchName,
      } = params;

      // Phase 1: validate the request and resolve the restore target under the
      // app lock WITHOUT cancelling any streams. Chat/message deletion endpoints
      // take this same lock, so the snapshot we validate against stays
      // consistent, and bailing out here for an invalid request never aborts
      // unrelated in-flight generations for a restore that cannot succeed.
      const prepared = await withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        const appPath = getDyadAppPath(app.path);
        if (restoreCodebase) {
          // Validate the branch anchor before cancelling any streams. The same
          // check runs again during the mutation to protect against a ref change
          // in the cancellation window.
          await resolveRestoreRef({ appPath, targetBranchName });
        }

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

        const messagesBefore = chat.messages
          .slice(0, targetIndex)
          .filter(
            (message) =>
              !(message.isCompactionSummary && message.id > messageId),
          );

        // Restoring to the very first message is allowed: "version 1" is the
        // commit that existed before the first message's changes were applied,
        // so we restore to that version and fork an empty chat (no prior
        // messages to copy). The empty chat starts from the restored version.

        const targetCommitHash = resolveTargetCommitHash({
          chatMessages: chat.messages,
          targetIndex,
          initialCommitHash: chat.initialCommitHash,
        });

        if (restoreCodebase) {
          if (!targetCommitHash) {
            // No version could be determined, so we don't create a new chat.
            // Omit `newChatId` so the renderer stays on the current chat instead
            // of "navigating" to the same one (which would look like a no-op).
            return {
              status: "warn" as const,
              warningMessage:
                "Could not determine a version to restore to for this message.",
            };
          }
          // The hash was resolved from stored DB fields, so a garbage-collected
          // or stale value would otherwise surface as an opaque git error from
          // `gitStageToRevert`. Validate it exists before cancelling any streams
          // (mirroring the `revertVersion` flow) so an invalid target returns a
          // user-friendly warning instead of aborting in-flight generations for
          // a restore that cannot proceed.
          try {
            await assertVersionExists({
              appPath,
              versionId: targetCommitHash,
            });
          } catch (error) {
            if (
              error instanceof DyadError &&
              error.kind === DyadErrorKind.NotFound
            ) {
              return {
                status: "warn" as const,
                warningMessage:
                  "Could not restore the codebase because the target version no longer exists in the repository.",
              };
            }
            throw error;
          }
        }

        return {
          status: "ready" as const,
          app,
          appPath,
          chat,
          messagesBefore,
          targetCommitHash,
        };
      });

      // A validated request that cannot proceed returns a warning without ever
      // cancelling streams (see phase 1 above).
      if (prepared.status === "warn") {
        return versionCommandResult({
          repositoryOutcome: "unchanged",
          notification: {
            kind: "warning",
            message: prepared.warningMessage,
          },
        });
      }
      const { appPath } = prepared;

      // Install the stream admission block that keeps new turns out while we
      // cancel and mutate. Only the codebase-restoring path mutates git/the
      // filesystem, so it needs an app-wide block to keep new turns in any chat
      // from writing into the tree mid-revert. The fork-only path just inserts a
      // new chat via an atomic DB transaction; blocking every chat in the app
      // would be unnecessarily aggressive, so scope its block to the source
      // chat.
      const releaseStreamAdmissionBlock = restoreCodebase
        ? blockNewStreamsForApp(appId)
        : blockNewStreamsForChat(chatId);

      // Wrap phases 2 and 3 in a single try/finally so the admission block is
      // always released, even if `withLock` were to throw synchronously before
      // returning its promise (which would skip a `.finally()` attached to that
      // promise). Leaking the block would permanently stall new streams for the
      // app/chat until the process restarts.
      try {
        // Phase 2: cancel in-flight streams for this app OUTSIDE the lock. The
        // cancellation helper aborts each stream and then awaits its handler
        // unwinding, and those handlers can take the same app lock for their own
        // writes (e.g. the copy_file tool). Awaiting stream completion while
        // holding the app lock would deadlock, so cancellation must run before
        // we re-acquire it — this matches the lock ordering documented on
        // `cancelActiveStreamsForApp`.
        const preserveDirtyTree = restoreCodebase
          ? await cancelActiveStreamsForApp(appId, event.sender)
          : false;

        // Phase 3: perform the codebase revert and create the forked chat under
        // the lock. Holding it across the whole mutation serializes the revert
        // against other version/deletion operations. The stream admission block
        // above also prevents new turns from entering through file tools that do
        // not take this lock. `gitStageToRevert` additionally refuses to run —
        // or commits a recoverable checkpoint when preserving an interrupted
        // turn — if the work tree is dirty, so a stray write can't be silently
        // clobbered.
        return await withLock(appId, async () => {
          const latestApp = await db.query.apps.findFirst({
            where: eq(apps.id, appId),
          });
          if (!latestApp) {
            throw new DyadError("App not found", DyadErrorKind.NotFound);
          }

          const latestChat = await db.query.chats.findFirst({
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
          if (!latestChat) {
            throw new DyadError("Chat not found", DyadErrorKind.NotFound);
          }
          if (latestChat.appId !== appId) {
            throw new DyadError(
              "Chat does not belong to this app",
              DyadErrorKind.Validation,
            );
          }

          const latestTargetIndex = latestChat.messages.findIndex(
            (m) => m.id === messageId,
          );
          if (latestTargetIndex === -1) {
            throw new DyadError("Message not found", DyadErrorKind.NotFound);
          }

          const latestMessagesBefore = latestChat.messages
            .slice(0, latestTargetIndex)
            .filter(
              (message) =>
                !(message.isCompactionSummary && message.id > messageId),
            );

          const latestTargetCommitHash = resolveTargetCommitHash({
            chatMessages: latestChat.messages,
            targetIndex: latestTargetIndex,
            initialCommitHash: latestChat.initialCommitHash,
          });

          if (restoreCodebase && !latestTargetCommitHash) {
            return versionCommandResult({
              repositoryOutcome: "unchanged",
              notification: {
                kind: "warning",
                message: appendInterruptedGenerationWarning(
                  "Could not determine a version to restore to for this message.",
                  preserveDirtyTree,
                ),
              },
            });
          }
          if (restoreCodebase && latestTargetCommitHash) {
            try {
              await assertVersionExists({
                appPath,
                versionId: latestTargetCommitHash,
              });
            } catch (error) {
              if (
                error instanceof DyadError &&
                error.kind === DyadErrorKind.NotFound
              ) {
                return versionCommandResult({
                  repositoryOutcome: "unchanged",
                  notification: {
                    kind: "warning",
                    message: appendInterruptedGenerationWarning(
                      "Could not restore the codebase because the target version no longer exists in the repository.",
                      preserveDirtyTree,
                    ),
                  },
                });
              }
              throw error;
            }
          }

          // When the user chose to also restore the codebase, we need a concrete
          // version to revert to. Revert the codebase first: if this throws (e.g.
          // a Git or Neon error), we bail out before touching the database so we
          // don't leave an orphaned, partially-created chat behind. A
          // `warningMessage` still means the codebase was reverted (only a
          // secondary step failed), so we go on to create the new chat in that
          // case. When the user only forks the chat, we skip the revert entirely.
          let successMessage = "Forked the chat into a new chat.";
          let warningMessage = "";

          if (restoreCodebase && latestTargetCommitHash) {
            const result = await revertCodebaseToVersion({
              appId,
              app: latestApp,
              appPath,
              previousVersionId: latestTargetCommitHash,
              targetBranchName,
              preserveDirtyTree,
            });
            successMessage = result.successMessage;
            warningMessage = result.warningMessage;
          }

          // Carry over the original chat's title so the forked chat is tied to
          // the conversation it came from without storing an English-only suffix
          // in the database. If the original is untitled, keep the fork untitled
          // and let the renderer's localized fallback title handle display.
          const restoredTitle = latestChat.title;

          // Anchor the forked chat to the version it actually starts from. When we
          // restored the codebase, that's the target version. When we only forked
          // the chat (codebase left untouched), the new chat starts from the
          // live branch's current commit, so use that instead of the historical
          // target. If the Version pane has a detached historical preview checked
          // out, `targetBranchName` points at the branch the pane will restore on
          // close; anchoring to that branch avoids leaving the fork attached to an
          // abandoned preview commit.
          const forkInitialCommitHash = restoreCodebase
            ? latestTargetCommitHash
            : await (async () => {
                const currentBranch = await gitCurrentBranch({
                  path: appPath,
                }).catch(() => null);
                const forkRef = currentBranch || targetBranchName || "HEAD";
                return getCurrentCommitHash({ path: appPath, ref: forkRef });
              })().catch(
                () => latestChat.initialCommitHash ?? latestTargetCommitHash,
              );

          // Compile-time guard so a new column added to the `messages` schema in
          // db/schema.ts isn't silently dropped when copying messages into the
          // forked chat. Every column must be classified below as either copied
          // (in the `.map` further down) or intentionally excluded; adding a
          // column to the schema without listing it here becomes a type error.
          type CopiedMessageColumn =
            | "role"
            | "content"
            | "approvalState"
            | "sourceCommitHash"
            | "commitHash"
            | "requestId"
            | "maxTokensUsed"
            | "model"
            | "aiMessagesJson"
            | "isCompactionSummary"
            | "createdAt";
          // Deliberately not copied from the source message:
          //  - `id`: autoIncrement primary key, generated per inserted row.
          //  - `chatId`: set to the newly created chat below.
          //  - `usingFreeAgentModeQuota`: reset to false (see note below).
          type ExcludedMessageColumn =
            | "id"
            | "chatId"
            | "usingFreeAgentModeQuota";
          // If a column is neither copied nor excluded, this `Exclude` is no
          // longer `never` and the assignment fails to compile, flagging the
          // unclassified column.
          const _assertAllMessageColumnsHandled: Exclude<
            keyof typeof messages.$inferSelect,
            CopiedMessageColumn | ExcludedMessageColumn
          > extends never
            ? true
            : never = true;
          void _assertAllMessageColumnsHandled;

          const messagesBeforeInInsertOrder = [...latestMessagesBefore].sort(
            (a, b) => a.id - b.id,
          );

          // Create the new chat pointing at that version and copy over the earlier
          // messages atomically. We insert directly (instead of using the
          // createChat handler) so `initialCommitHash` is the intended version
          // rather than whatever the createChat handler would capture. Wrapping
          // both inserts in a transaction ensures we never leave behind an
          // orphaned, empty forked chat if the messages insert fails after
          // the chat insert. better-sqlite3 transactions are synchronous, so the
          // callback uses the sync query API (`.get()`/`.run()`) rather than
          // `await`.
          const newChat = db.transaction((tx) => {
            const createdChat = tx
              .insert(chats)
              .values({
                appId,
                title: restoredTitle,
                chatMode: latestChat.chatMode,
                initialCommitHash: forkInitialCommitHash,
              })
              .returning()
              .get();

            // Copy all messages that came before the target message into the new
            // chat, preserving display ordering via `createdAt` while inserting
            // in original ID order. Compaction summaries are deliberately
            // backdated for display but must keep their identity boundary after
            // the user turn that triggered them.
            if (messagesBeforeInInsertOrder.length > 0) {
              tx.insert(messages)
                .values(
                  // IMPORTANT: keep this field list in sync with the `messages`
                  // table schema in db/schema.ts. New columns are NOT copied
                  // automatically — add them here (or make a conscious decision to
                  // omit them, like `usingFreeAgentModeQuota` below) when the
                  // schema changes. The `_assertAllMessageColumnsHandled` guard
                  // above enforces this classification at compile time.
                  messagesBeforeInInsertOrder.map((m) => ({
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
                    // Don't carry over the free-agent quota flag. The copied
                    // messages represent already-completed turns; preserving the
                    // flag would make getFreeAgentQuotaStatus (which counts every
                    // row globally) double-count those past requests and could
                    // exhaust a non-Pro user's quota without any new model call.
                    usingFreeAgentModeQuota: false,
                    isCompactionSummary: m.isCompactionSummary,
                    createdAt: m.createdAt,
                  })),
                )
                .run();
            }

            return createdChat;
          });

          return versionCommandResult({
            repositoryOutcome: restoreCodebase ? "target-applied" : "unchanged",
            notification: warningMessage
              ? {
                  kind: "warning",
                  message: restoreCodebase
                    ? `Code restored, but: ${warningMessage}`
                    : warningMessage,
                }
              : { kind: "success", message: successMessage },
            runtimeAction: versionRuntimeAction(latestApp, restoreCodebase),
            createdChatId: newChat.id,
          });
        });
      } finally {
        releaseStreamAdmissionBlock?.();
      }
    },
  );

  createTypedHandler(versionContracts.checkoutVersion, async (_, params) => {
    const { appId } = params;
    const gitRef =
      params.purpose === "preview" ? params.versionId : params.branch;
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
        if (params.purpose === "return") {
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
      return versionCommandResult({
        notification: warningMessage
          ? { kind: "warning", message: warningMessage }
          : null,
        runtimeAction: versionRuntimeAction(app, true),
      });
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
