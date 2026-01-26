import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { freeAgentQuotaContracts } from "../types/free_agent_quota";
import log from "electron-log";

const logger = log.scope("free_agent_quota_handlers");

/** Maximum number of free agent messages per 24-hour window */
export const FREE_AGENT_QUOTA_LIMIT = 5;

/** Duration of the quota window in milliseconds (24 hours) */
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export function registerFreeAgentQuotaHandlers() {
  createTypedHandler(
    freeAgentQuotaContracts.getFreeAgentQuotaStatus,
    async () => {
      return await getFreeAgentQuotaStatus();
    },
  );
}

/**
 * Marks a message as using the free agent quota.
 * This should be called after a successful Basic Agent mode message.
 */
export async function markMessageAsUsingFreeAgentQuota(
  messageId: number,
): Promise<void> {
  await db
    .update(messages)
    .set({ usingFreeAgentModeQuota: true })
    .where(eq(messages.id, messageId));

  logger.log(`Marked message ${messageId} as using free agent quota`);
}

/**
 * Gets the current free agent quota status.
 * Exported for use in chat stream handlers.
 *
 * Quota behavior: All 5 messages are released at once when 24 hours have passed
 * since the oldest message was sent (not a rolling window).
 */
export async function getFreeAgentQuotaStatus() {
  // Get quota messages ordered by creation time
  // Limit to FREE_AGENT_QUOTA_LIMIT + 1 for efficiency (we only need to know if >= limit)
  const quotaMessages = await db
    .select({
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.usingFreeAgentModeQuota, true))
    .orderBy(messages.createdAt)
    .limit(FREE_AGENT_QUOTA_LIMIT + 1);

  // If there are no quota messages, quota is fresh
  if (quotaMessages.length === 0) {
    return {
      messagesUsed: 0,
      messagesLimit: FREE_AGENT_QUOTA_LIMIT,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    };
  }

  // Check if the oldest message is >= 24 hours old
  // If so, all 5 messages are released at once (quota resets)
  const oldestMessage = quotaMessages[0];
  const windowStartTime = oldestMessage.createdAt.getTime();
  const resetTime = windowStartTime + QUOTA_WINDOW_MS;
  const now = Date.now();

  if (now >= resetTime) {
    // Quota has reset - clear all old quota flags to prevent bypass
    await db
      .update(messages)
      .set({ usingFreeAgentModeQuota: false })
      .where(eq(messages.usingFreeAgentModeQuota, true));

    logger.log("Quota window reset - cleared all quota flags");

    return {
      messagesUsed: 0,
      messagesLimit: FREE_AGENT_QUOTA_LIMIT,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    };
  }

  // Quota has not reset - count all quota messages
  const messagesUsed = quotaMessages.length;
  const isQuotaExceeded = messagesUsed >= FREE_AGENT_QUOTA_LIMIT;
  let hoursUntilReset = Math.ceil((resetTime - now) / (60 * 60 * 1000));
  if (hoursUntilReset < 0) hoursUntilReset = 0;

  return {
    messagesUsed,
    messagesLimit: FREE_AGENT_QUOTA_LIMIT,
    isQuotaExceeded,
    windowStartTime,
    resetTime,
    hoursUntilReset,
  };
}
