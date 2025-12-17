import type { ModelMessage } from "ai";
import log from "electron-log";

const logger = log.scope("ai_messages_utils");

/** Maximum size in bytes for ai_messages_json (1MB) */
export const MAX_AI_MESSAGES_SIZE = 1_000_000;

/**
 * Check if ai_messages_json is within size limits and return the value to save.
 * Returns undefined if the messages exceed the size limit.
 */
export function getAiMessagesJsonIfWithinLimit(
  aiMessages: ModelMessage[],
): ModelMessage[] | undefined {
  if (!aiMessages || aiMessages.length === 0) {
    return undefined;
  }

  const jsonStr = JSON.stringify(aiMessages);
  if (jsonStr.length <= MAX_AI_MESSAGES_SIZE) {
    return aiMessages;
  }

  logger.warn(
    `ai_messages_json too large (${jsonStr.length} bytes), skipping save`,
  );
  return undefined;
}
