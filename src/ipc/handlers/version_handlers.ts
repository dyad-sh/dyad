import { db } from "../../db";
import { apps, messages, snapshots, favorites } from "../../db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type { Version, BranchResult } from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import git, { type ReadCommitResult } from "isomorphic-git";
import { withLock } from "../utils/lock_utils";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { gitCheckout, gitCommit, gitStageToRevert } from "../utils/git_utils";
import {
  storeTimestampAtCommitHash,
  getLastUpdatedTimestampFromNeon,
} from "../utils/neon_lsn_utils";
import { getNeonClient } from "../../neon_admin/neon_management_client";


const logger = log.scope("version_handlers");

const handle = createLoggedHandler(logger);

/**
 * Restores the database to match a target commit hash by either using a favorite branch
 * or creating a restore from a snapshot timestamp
 */
async function restoreToFavoriteOrSnapshot({
  appId,
  targetCommitHash,
  neonProjectId,
  neonBranchId,
}: {
  appId: number;
  targetCommitHash: string;
  neonProjectId: string;
  neonBranchId: string;
}): Promise<void> {
  try {
    // First check if the target commit hash exists in favorites
    const targetFavorite = await db.query.favorites.findFirst({
      where: and(
        eq(favorites.appId, appId),
        eq(favorites.commitHash, targetCommitHash),
      ),
    });

    if (targetFavorite && targetFavorite.neonBranchId) {
      // Use the existing favorite branch to restore from
      logger.info(
        `Found favorite branch ${targetFavorite.neonBranchId} for commit ${targetCommitHash}`,
      );

      const neonClient = await getNeonClient();

      try {
        // Restore the current branch from the favorite branch
        const branchResponse = await neonClient.restoreProjectBranch(
          neonProjectId,
          neonBranchId,
          {
            source_branch_id: targetFavorite.neonBranchId,
          },
        );

        if (!branchResponse.data.branch) {
          throw new Error(
            "Failed to restore from favorite branch: No branch data returned.",
          );
        }

        logger.info(
          `Successfully restored current branch from favorite branch ${targetFavorite.neonBranchId} for commit ${targetCommitHash}`,
        );
      } catch (neonError) {
        logger.error("Failed to restore from favorite branch:", neonError);
        throw new Error(`Failed to restore from favorite: ${neonError}`);
      }
    } else {
      // Fall back to snapshot-based restoration
      const targetSnapshot = await db.query.snapshots.findFirst({
        where: and(
          eq(snapshots.appId, appId),
          eq(snapshots.commitHash, targetCommitHash),
        ),
      });

      if (targetSnapshot && targetSnapshot.dbTimestamp) {
        logger.info(
          `Found snapshot with timestamp ${targetSnapshot.dbTimestamp} for commit ${targetCommitHash}`,
        );

        // Create a new branch from the target timestamp to restore database state
        const neonClient = await getNeonClient();

        try {
          // Create a new branch from the parent with the target timestamp
          const branchResponse = await neonClient.restoreProjectBranch(
            neonProjectId,
            neonBranchId,
            {
              source_branch_id: neonBranchId,
              source_timestamp: targetSnapshot.dbTimestamp,
            },
          );

          if (!branchResponse.data.branch) {
            throw new Error(
              "Failed to create restore branch: No branch data returned.",
            );
          }

          logger.info(
            `Successfully restored Neon database to timestamp ${targetSnapshot.dbTimestamp} for commit ${targetCommitHash}`,
          );
        } catch (neonError) {
          logger.error("Failed to create restore branch:", neonError);
          throw new Error(`Failed to restore database: ${neonError}`);
        }
      } else {
        logger.warn(
          `No snapshot with timestamp found for commit ${targetCommitHash}. Database will remain at current state.`,
        );
      }
    }
  } catch (error) {
    logger.error("Error in restoreToFavoriteOrSnapshot:", error);
    throw error;
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
      depth: 10_000, // Limit to last 10_000 commits for performance
    });

    // Get all snapshots for this app to match with commits
    const appSnapshots = await db.query.snapshots.findMany({
      where: eq(snapshots.appId, appId),
    });

    // Get all favorites for this app to match with commits
    const appFavorites = await db.query.favorites.findMany({
      where: eq(favorites.appId, appId),
    });

    // Create a map of commitHash -> snapshot info for quick lookup
    const snapshotMap = new Map<
      string,
      { dbTimestamp: string | null; createdAt: Date }
    >();
    for (const snapshot of appSnapshots) {
      snapshotMap.set(snapshot.commitHash, {
        dbTimestamp: snapshot.dbTimestamp,
        createdAt: snapshot.createdAt,
      });
    }

    // Create a map of commitHash -> favorite info for quick lookup
    const favoriteMap = new Map<string, { neonBranchId: string | null }>();
    for (const favorite of appFavorites) {
      favoriteMap.set(favorite.commitHash, {
        neonBranchId: favorite.neonBranchId,
      });
    }

    // Helper function to check if snapshot is less than 24 hours old
    const isSnapshotRecent = (createdAt: Date): boolean => {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return createdAt > twentyFourHoursAgo;
    };

    return commits.map((commit: ReadCommitResult) => {
      const snapshotInfo = snapshotMap.get(commit.oid);
      const favoriteInfo = favoriteMap.get(commit.oid);

      // hasDbSnapshot is true if:
      // 1. There's a snapshot with dbTimestamp and it's less than 24 hours old, OR
      // 2. There's a favorite with a neonBranchId
      const hasDbSnapshot =
        (snapshotInfo &&
          snapshotInfo.dbTimestamp !== null &&
          isSnapshotRecent(snapshotInfo.createdAt)) ||
        (favoriteInfo && favoriteInfo.neonBranchId !== null);

      return {
        oid: commit.oid,
        message: commit.commit.message,
        timestamp: commit.commit.author.timestamp,
        hasDbSnapshot,
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
      {
        appId,
        previousVersionId,
      }: { appId: number; previousVersionId: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);

        // Store timestamp at current hash
        try {
          // Get the current commit hash before reverting
          const currentCommitHash = await git.resolveRef({
            fs,
            dir: appPath,
            ref: "HEAD",
          });

          // Only store timestamp if the app has Neon integration
          if (app.neonProjectId && app.neonBranchId) {
            const currentTimestamp = await getLastUpdatedTimestampFromNeon(
              app.neonProjectId,
              app.neonBranchId,
            );

            if (currentTimestamp) {
              await storeTimestampAtCommitHash({
                appId,
                commitHash: currentCommitHash,
                timestamp: currentTimestamp,
              });
              logger.info(
                `Stored timestamp ${currentTimestamp} for current commit ${currentCommitHash} before reverting`,
              );
            }
          }
        } catch (error) {
          logger.error("Error storing timestamp at current hash:", error);
          throw error;
        }

        await gitCheckout({
          path: appPath,
          ref: "main",
        });

        await gitStageToRevert({
          path: appPath,
          targetOid: previousVersionId,
        });

        await gitCommit({
          path: appPath,
          message: `Reverted all changes back to version ${previousVersionId}`,
        });

        // Set Neon DB to the DB stamp found for the snapshot of the target hash
        if (app.neonProjectId && app.neonBranchId) {
          try {
            await restoreToFavoriteOrSnapshot({
              appId,
              targetCommitHash: previousVersionId,
              neonProjectId: app.neonProjectId,
              neonBranchId: app.neonBranchId,
            });
          } catch (error) {
            logger.error("Error restoring database for target hash:", error);
            // Continue with revert even if database restoration fails
          }
        }

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
      });
    },
  );

  handle(
    "checkout-version",
    async (
      _,
      { appId, versionId }: { appId: number; versionId: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);

        await gitCheckout({
          path: appPath,
          ref: versionId,
        });
      });
    },
  );
}
