import log from "electron-log";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";

const logger = log.scope("ai_messages_cleanup");

export const AI_MESSAGES_TTL_DAYS = 30;

/**
 * Clear ai_messages_json for messages older than TTL.
 * Run on app startup to prevent database bloat.
 */
export async function cleanupOldAiMessagesJson() {
  const cutoffSeconds =
    Math.floor(Date.now() / 1000) - AI_MESSAGES_TTL_DAYS * 24 * 60 * 60;
  const cutoffDate = new Date(cutoffSeconds * 1000);

  try {
    await db
      .update(messages)
      .set({ aiMessagesJson: null })
      .where(lt(messages.createdAt, cutoffDate));

    logger.log("Cleaned up old ai_messages_json entries");
  } catch (err) {
    logger.warn("Failed to cleanup old ai_messages_json:", err);
  }
}
