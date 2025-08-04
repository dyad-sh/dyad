import { db } from "../../db";
import { apps, messages, versions } from "../../db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type {
  Version,
  BranchResult,
  RevertVersionParams,
  RevertVersionResponse,
} from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import git, { type ReadCommitResult } from "isomorphic-git";
import { withLock } from "../utils/lock_utils";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { gitCheckout, gitCommit, gitStageToRevert } from "../utils/git_utils";

import {
  getNeonClient,
  getNeonErrorMessage,
} from "../../neon_admin/neon_management_client";
import {
  updatePostgresUrlEnvVar,
  updateDbPushEnvVar,
} from "../utils/app_env_var_utils";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";
import { retryOnLocked } from "../utils/retryOnLocked";

const logger = log.scope("version_handlers");

const handle = createLoggedHandler(logger);

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

export function registerVersionHandlers() {
  handle("list-versions", async (_, { appId }: { appId: number }) => {
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

    const commits = await git.log({
      fs,
      dir: appPath,
      // KEEP UP TO DATE WITH ChatHeader.tsx
      depth: 100_000, // Limit to last 100_000 commits for performance
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

    return commits.map((commit: ReadCommitResult) => {
      const snapshotInfo = snapshotMap.get(commit.oid);
      return {
        oid: commit.oid,
        message: commit.commit.message,
        timestamp: commit.commit.author.timestamp,
        dbTimestamp: snapshotInfo?.neonDbTimestamp,
      };
    }) satisfies Version[];
  });

  handle(
    "get-current-branch",
    async (_, { appId }: { appId: number }): Promise<BranchResult> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);

      // Return appropriate result if the app is not a git repo
      if (!fs.existsSync(path.join(appPath, ".git"))) {
        throw new Error("Not a git repository");
      }

      try {
        const currentBranch = await git.currentBranch({
          fs,
          dir: appPath,
          fullname: false,
        });

        return {
          branch: currentBranch || "<no-branch>",
        };
      } catch (error: any) {
        logger.error(`Error getting current branch for app ${appId}:`, error);
        throw new Error(`Failed to get current branch: ${error.message}`);
      }
    },
  );

  handle(
    "revert-version",
    async (
      _,
      { appId, previousVersionId }: RevertVersionParams,
    ): Promise<RevertVersionResponse> => {
      return withLock(appId, async () => {
        let successMessage = "Restored version";
        let warningMessage: string | undefined = undefined;
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);
        // Get the current commit hash before reverting
        const currentCommitHash = await git.resolveRef({
          fs,
          dir: appPath,
          ref: "main",
        });

        await gitCheckout({
          path: appPath,
          ref: "main",
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

        await gitCommit({
          path: appPath,
          message: `Reverted all changes back to version ${previousVersionId}`,
        });

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
                throw new Error("Preserve branch ID not found");
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
            } catch (error) {
              const errorMessage = getNeonErrorMessage(error);
              logger.error("Error in restoreBranchForCheckout:", errorMessage);
              warningMessage = `Could not restore database because of error: ${errorMessage}`;
              // Do not throw, so we can finish switching the postgres branch
              // It might throw because they picked a timestamp that's too old.
            }
            successMessage =
              "Successfully restored to version (including database)";
          }
          await switchPostgresToDevelopmentBranch({
            neonProjectId: app.neonProjectId,
            neonDevelopmentBranchId: app.neonDevelopmentBranchId,
            appPath: app.path,
          });
        }
        if (warningMessage) {
          return { warningMessage };
        }
        return { successMessage };
      });
    },
  );

  handle(
    "checkout-version",
    async (
      _,
      { appId, versionId: gitRef }: { appId: number; versionId: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
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
            logger.info(
              `Switching Postgres to preview branch for app ${appId}`,
            );

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
              const neonClient = await getNeonClient();
              const connectionUri = await neonClient.getConnectionUri({
                projectId: app.neonProjectId,
                branch_id: app.neonPreviewBranchId,
                // This is the default database name for Neon
                database_name: "neondb",
                // This is the default role name for Neon
                role_name: "neondb_owner",
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
                connectionUri: connectionUri.data.uri,
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
      });
    },
  );
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
  const neonClient = await getNeonClient();
  const connectionUri = await neonClient.getConnectionUri({
    projectId: neonProjectId,
    branch_id: neonDevelopmentBranchId,
    // This is the default database name for Neon
    database_name: "neondb",
    // This is the default role name for Neon
    role_name: "neondb_owner",
  });

  await updatePostgresUrlEnvVar({
    appPath,
    connectionUri: connectionUri.data.uri,
  });

  await updateDbPushEnvVar({
    appPath,
    disabled: false,
  });
}
