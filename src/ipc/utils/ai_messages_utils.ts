import { AI_MESSAGES_SDK_VERSION, AiMessagesJsonV6 } from "@/db/schema";
import type { ModelMessage } from "ai";
import log from "electron-log";

const logger = log.scope("ai_messages_utils");

/**
 * Provider option keys that may contain itemId references to OpenAI's
 * server-side storage. These references become stale when items expire.
 */
const PROVIDER_KEYS_WITH_ITEM_ID = ["openai", "azure"] as const;

/**
 * Strip OpenAI item IDs from provider metadata on all message content parts.
 *
 * When messages are persisted to DB with aiMessagesJson, they may contain
 * `providerMetadata.openai.itemId` values that reference items stored on OpenAI's
 * servers. On subsequent turns, the AI SDK converts these to `item_reference`
 * payloads instead of sending full content. If OpenAI has expired those items,
 * this causes "Item with id 'rs_...' not found" errors.
 *
 * Stripping itemId forces the SDK to always send full message content, which is
 * already stored in the message parts alongside the itemId, so no data is lost.
 */
function stripItemIds(messages: ModelMessage[]): ModelMessage[] {
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      stripItemIdFromObject(part as Record<string, unknown>);
    }
  }
  return messages;
}

function stripItemIdFromObject(obj: Record<string, unknown>): void {
  for (const field of ["providerOptions", "providerMetadata"] as const) {
    const container = obj[field];
    if (!container || typeof container !== "object") continue;

    const containerRecord = container as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of PROVIDER_KEYS_WITH_ITEM_ID) {
      const providerData = containerRecord[key];
      if (
        providerData &&
        typeof providerData === "object" &&
        "itemId" in providerData
      ) {
        delete providerData.itemId;
        // Clean up empty provider data
        if (Object.keys(providerData).length === 0) {
          delete containerRecord[key];
        }
      }
    }
    // Clean up empty container
    if (Object.keys(containerRecord).length === 0) {
      delete obj[field];
    }
  }
}

/** Maximum size in bytes for ai_messages_json (10MB) */
export const MAX_AI_MESSAGES_SIZE = 10_000_000;

/**
 * Check if ai_messages_json is within size limits and return the value to save.
 * Returns undefined if the messages exceed the size limit.
 */
export function getAiMessagesJsonIfWithinLimit(
  aiMessages: ModelMessage[],
): AiMessagesJsonV6 | undefined {
  if (!aiMessages || aiMessages.length === 0) {
    return undefined;
  }

  const payload: AiMessagesJsonV6 = {
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
  aiMessagesJson: AiMessagesJsonV6 | ModelMessage[] | null;
};

/**
 * Parse ai_messages_json with graceful fallback to simple content reconstruction.
 * If aiMessagesJson is missing, malformed, or incompatible with the current AI SDK,
 * falls back to constructing a basic message from role and content.
 */
export function parseAiMessagesJson(msg: DbMessageForParsing): ModelMessage[] {
  if (msg.aiMessagesJson) {
    const parsed = msg.aiMessagesJson;

    // Legacy shape: stored directly as a ModelMessage[]
    if (
      Array.isArray(parsed) &&
      parsed.every((m) => m && typeof m.role === "string")
    ) {
      return stripItemIds(parsed);
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "sdkVersion" in parsed &&
      (parsed as AiMessagesJsonV6).sdkVersion === AI_MESSAGES_SDK_VERSION &&
      "messages" in parsed &&
      Array.isArray((parsed as AiMessagesJsonV6).messages) &&
      (parsed as AiMessagesJsonV6).messages.every(
        (m: ModelMessage) => m && typeof m.role === "string",
      )
    ) {
      return stripItemIds((parsed as AiMessagesJsonV6).messages);
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
