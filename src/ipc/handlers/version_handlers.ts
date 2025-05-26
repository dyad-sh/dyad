import { db } from "../../db";
import { apps, messages } from "../../db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type { Version, BranchResult } from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import git from "isomorphic-git";
import { promises as fsPromises } from "node:fs";
import { withLock } from "../utils/lock_utils";
import { getGitAuthor } from "../utils/git_author";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";

const logger = log.scope("version_handlers");

const handle = createLoggedHandler(logger);

export function registerVersionHandlers() {
  handle("list-versions", async (_, { appId }: { appId: number }) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
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

    return commits.map((commit) => ({
      oid: commit.oid,
      message: commit.commit.message,
      timestamp: commit.commit.author.timestamp,
    })) satisfies Version[];
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

        await git.checkout({
          fs,
          dir: appPath,
          ref: "main",
          force: true,
        });
        // Get status matrix comparing the target commit (previousVersionId as HEAD) with current working directory
        const matrix = await git.statusMatrix({
          fs,
          dir: appPath,
          ref: previousVersionId,
        });

        // Process each file to revert to the state in previousVersionId
        for (const [filepath, headStatus, workdirStatus] of matrix) {
          const fullPath = path.join(appPath, filepath);

          // If file exists in HEAD (previous version)
          if (headStatus === 1) {
            // If file doesn't exist or has changed in working directory, restore it from the target commit
            if (workdirStatus !== 1) {
              const { blob } = await git.readBlob({
                fs,
                dir: appPath,
                oid: previousVersionId,
                filepath,
              });
              await fsPromises.mkdir(path.dirname(fullPath), {
                recursive: true,
              });
              await fsPromises.writeFile(fullPath, Buffer.from(blob));
            }
          }
          // If file doesn't exist in HEAD but exists in working directory, delete it
          else if (headStatus === 0 && workdirStatus !== 0) {
            if (fs.existsSync(fullPath)) {
              await fsPromises.unlink(fullPath);
              await git.remove({
                fs,
                dir: appPath,
                filepath: filepath,
              });
            }
          }
        }

        // Stage all changes
        await git.add({
          fs,
          dir: appPath,
          filepath: ".",
        });

        // Create a revert commit
        await git.commit({
          fs,
          dir: appPath,
          message: `Reverted all changes back to version ${previousVersionId}`,
          author: await getGitAuthor(),
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

        await git.checkout({
          fs,
          dir: appPath,
          ref: versionId,
        });
      });
    },
  );
}
