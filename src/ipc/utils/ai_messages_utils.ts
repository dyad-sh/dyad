import { AI_MESSAGES_SDK_VERSION, AiMessagesJsonV5 } from "@/db/schema";
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
): AiMessagesJsonV5 | undefined {
  if (!aiMessages || aiMessages.length === 0) {
    return undefined;
  }

  const payload: AiMessagesJsonV5 = {
    messages: aiMessages,
    sdkVersion: AI_MESSAGES_SDK_VERSION,
  };

  const jsonStr = JSON.stringify(payload);
  if (jsonStr.length <= MAX_AI_MESSAGES_SIZE) {
    return payload;
  }

  logger.warn(
    `ai_messages_json too large (${jsonStr.length} bytes), skipping save`,
  );
  return undefined;
}

// Type for a message from the database used by parseAiMessagesJson
export type DbMessageForParsing = {
  id: number;
  role: string;
  content: string;
  aiMessagesJson: AiMessagesJsonV5 | ModelMessage[] | null;
};

/**
 * Parse ai_messages_json with graceful fallback to simple content reconstruction.
 * If aiMessagesJson is missing, malformed, or incompatible with the current AI SDK,
 * falls back to constructing a basic message from role and content.
 *
 * This is a pure function - it doesn't log or have side effects.
 */
export function parseAiMessagesJson(msg: DbMessageForParsing): ModelMessage[] {
  if (msg.aiMessagesJson) {
    const parsed = msg.aiMessagesJson;

    // Legacy shape: stored directly as a ModelMessage[]
    if (
      Array.isArray(parsed) &&
      parsed.every((m) => m && typeof m.role === "string")
    ) {
      return parsed;
    }

    // Current shape: { messages: ModelMessage[]; sdkVersion: "ai@v5" }
    if (
      parsed &&
      typeof parsed === "object" &&
      "sdkVersion" in parsed &&
      (parsed as AiMessagesJsonV5).sdkVersion === AI_MESSAGES_SDK_VERSION &&
      "messages" in parsed &&
      Array.isArray((parsed as AiMessagesJsonV5).messages) &&
      (parsed as AiMessagesJsonV5).messages.every(
        (m: ModelMessage) => m && typeof m.role === "string",
      )
    ) {
      return (parsed as AiMessagesJsonV5).messages;
    }
  }

  // Fallback for legacy messages, missing data, or incompatible formats
  return [
    {
      role: msg.role as "user" | "assistant",
      content: msg.content,
    },
  ];
}
