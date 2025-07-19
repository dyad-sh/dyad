import { db } from "../../db";
import { messages, chats, snapshots } from "../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import log from "electron-log";

const logger = log.scope("neon_timestamp_utils");

/**
 * Retrieves the current timestamp from a Neon database branch
 */
export async function getLastUpdatedTimestampFromNeon(
  neonProjectId: string,
  neonBranchId: string,
): Promise<string | null> {
  try {
    const neonClient = await getNeonClient();

    // Get the connection string for the Neon database branch
    const projectBranchResponse = await neonClient.getProjectBranch(
      neonProjectId,
      neonBranchId,
    );

    return projectBranchResponse.data.branch.updated_at;
  } catch (error) {
    logger.error("Error retrieving timestamp from Neon:", error);
    return null;
  }
}

/**
 * Finds the commit hash from the previous message or chat and stores the timestamp in snapshots table
 * @param chatId - The chat ID
 * @param messageId - The current message ID
 * @param timestamp - The timestamp to store
 * @param appId - The app ID (needed for snapshots table)
 */
export async function storeTimestampInSnapshots(
  chatId: number,
  messageId: number,
  timestamp: string,
  appId: number,
): Promise<void> {
  try {
    let commitHash: string | null = null;

    // Get all messages for this chat to find the previous one
    const allMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: desc(messages.id),
    });

    // Find the message that comes before the current messageId
    const currentMessageIndex = allMessages.findIndex(
      (msg) => msg.id === messageId,
    );
    const previousMsg =
      currentMessageIndex >= 0 && currentMessageIndex < allMessages.length - 1
        ? allMessages[currentMessageIndex + 1]
        : null;

    if (previousMsg && previousMsg.commitHash) {
      commitHash = previousMsg.commitHash;
      logger.info(
        `Found commit hash ${commitHash} from previous message ${previousMsg.id}`,
      );
    } else {
      // No previous message with commit hash, check the chat's initial commit hash
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, chatId),
      });

      if (chat && chat.initialCommitHash) {
        commitHash = chat.initialCommitHash;
        logger.info(
          `No previous message with commit hash, using chat's initial commit hash ${commitHash}`,
        );
      }
    }

    if (!commitHash) {
      throw new Error(
        `No commit hash found for chat ${chatId}, message ${messageId}. Cannot store snapshot.`,
      );
    }

    // Check if a snapshot with this combination already exists
    const existingSnapshot = await db.query.snapshots.findFirst({
      where: and(
        eq(snapshots.appId, appId),
        eq(snapshots.commitHash, commitHash),
        eq(snapshots.dbTimestamp, timestamp),
      ),
    });

    if (existingSnapshot) {
      logger.info(
        `Snapshot already exists for app ${appId}, commit ${commitHash}, timestamp ${timestamp}. Skipping.`,
      );
      return;
    }

    // Insert the snapshot
    await db.insert(snapshots).values({
      appId,
      commitHash,
      dbTimestamp: timestamp,
    });

    logger.info(
      `Successfully stored snapshot for app ${appId}, commit ${commitHash}, timestamp ${timestamp}`,
    );
  } catch (error) {
    logger.error("Error storing timestamp in snapshots:", error);
    throw error;
  }
}

/**
 * Stores a timestamp directly for a specific commit hash in the snapshots table
 * @param appId - The app ID
 * @param commitHash - The commit hash
 * @param timestamp - The timestamp to store
 */
export async function storeTimestampAtCommitHash({
  appId,
  commitHash,
  timestamp,
}: {
  appId: number;
  commitHash: string;
  timestamp: string;
}): Promise<void> {
  try {
    logger.info(
      `Storing timestamp ${timestamp} for app ${appId}, commit ${commitHash}`,
    );

    // Check if a snapshot with this combination already exists
    const existingSnapshot = await db.query.snapshots.findFirst({
      where: and(
        eq(snapshots.appId, appId),
        eq(snapshots.commitHash, commitHash),
        eq(snapshots.dbTimestamp, timestamp),
      ),
    });

    if (existingSnapshot) {
      logger.info(
        `Snapshot already exists for app ${appId}, commit ${commitHash}, timestamp ${timestamp}. Skipping.`,
      );
      return;
    }

    // Insert the snapshot
    await db.insert(snapshots).values({
      appId,
      commitHash,
      dbTimestamp: timestamp,
    });

    logger.info(
      `Successfully stored snapshot for app ${appId}, commit ${commitHash}, timestamp ${timestamp}`,
    );
  } catch (error) {
    logger.error("Error storing timestamp at commit hash:", error);
    throw error;
  }
}

/**
 * Main function to retrieve timestamp and store it appropriately
 * @param chatId - The chat ID
 * @param messageId - The current message ID
 * @param appId - The app ID
 * @param neonProjectId - The Neon project ID
 * @param neonBranchId - The Neon branch ID
 */
export async function retrieveAndStoreTimestamp({
  chatId,
  messageId,
  appId,
  neonProjectId,
  neonBranchId,
}: {
  chatId: number;
  messageId: number;
  appId: number;
  neonProjectId: string;
  neonBranchId: string;
}): Promise<{ timestamp: string | null }> {
  try {
    logger.info(
      `Retrieving timestamp for chat ${chatId}, message ${messageId}`,
    );

    // Get the current timestamp from Neon
    const currentTimestamp = await getLastUpdatedTimestampFromNeon(
      neonProjectId,
      neonBranchId,
    );

    if (!currentTimestamp) {
      throw new Error("Could not retrieve current timestamp from Neon");
    }

    // Store the timestamp in the snapshots table with the commit hash
    await storeTimestampInSnapshots(chatId, messageId, currentTimestamp, appId);

    logger.info(
      `Successfully processed timestamp ${currentTimestamp} for chat ${chatId}`,
    );

    return { timestamp: currentTimestamp };
  } catch (error) {
    logger.error("Error in retrieveAndStoreTimestamp:", error);
    throw new Error("Could not retrieve and store timestamp: " + error);
  }
}
