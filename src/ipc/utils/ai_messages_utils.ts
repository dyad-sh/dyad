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
 * Strip itemId from a content part's provider metadata.
 * Returns true if any itemId was stripped (mutates the part in place).
 */
function stripItemIdFromPart(part: Record<string, unknown>): boolean {
  let didStrip = false;
  for (const field of ["providerOptions", "providerMetadata"] as const) {
    const container = part[field];
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
        didStrip = true;
        // Clean up empty provider data
        if (Object.keys(providerData).length === 0) {
          delete containerRecord[key];
        }
      }
    }
    // Clean up empty container
    if (Object.keys(containerRecord).length === 0) {
      delete part[field];
    }
  }
  return didStrip;
}

/**
 * Clean up a message's content parts for OpenAI compatibility:
 * 1. Strip itemId from provider metadata (prevents "Item with id not found" errors)
 * 2. Filter orphaned reasoning parts (prevents "reasoning without following item" errors)
 *
 * When messages contain `providerMetadata.openai.itemId` values, the AI SDK converts
 * these to `item_reference` payloads. If OpenAI has expired those items, this causes
 * "Item with id 'rs_...' not found" errors.
 *
 * Additionally, OpenAI's Responses API requires that reasoning items are always
 * followed by an output item (text, tool-call, etc.). If a reasoning item appears
 * at the end of a message without a following output, OpenAI returns:
 * "Item of type 'reasoning' was provided without its required following item."
 *
 * Returns the original message if no changes were needed, or a new message with cleaned content.
 */
export function cleanMessageForOpenAI<T extends ModelMessage>(message: T): T {
  if (typeof message.content === "string" || !Array.isArray(message.content)) {
    return message;
  }

  const cleanedContent = [];
  let didModify = false;

  for (let i = 0; i < message.content.length; i++) {
    const part = message.content[i] as { type?: string } & Record<
      string,
      unknown
    >;

    // Check if this is orphaned reasoning (no following output)
    if (part.type === "reasoning") {
      const hasFollowingOutput = message.content
        .slice(i + 1)
        .some((p) => (p as { type?: string }).type !== "reasoning");
      if (!hasFollowingOutput) {
        // Skip orphaned reasoning
        didModify = true;
        continue;
      }
    }

    // Strip itemId from provider metadata
    if (stripItemIdFromPart(part)) {
      didModify = true;
    }

    cleanedContent.push(part);
  }

  if (!didModify) {
    return message;
  }

  return { ...message, content: cleanedContent } as T;
}

/**
 * Clean all messages in an array for OpenAI compatibility.
 */
function cleanMessagesForOpenAI(messages: ModelMessage[]): ModelMessage[] {
  return messages.map(cleanMessageForOpenAI);
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
      return cleanMessagesForOpenAI(parsed);
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
      return cleanMessagesForOpenAI((parsed as AiMessagesJsonV6).messages);
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
