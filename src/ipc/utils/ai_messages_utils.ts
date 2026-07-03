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
 * 3. Ensure tool-call input is always a valid object (prevents LiteLLM sending empty string as input when converting OpenAI→Anthropic format)
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
export function cleanMessage<T extends ModelMessage>(message: T): T {
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

    // Ensure tool-call input is always a valid object (prevents LiteLLM
    // sending empty string as input when converting OpenAI→Anthropic format)
    if (
      part.type === "tool-call" &&
      (!part.input || typeof part.input !== "object")
    ) {
      part.input = {};
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
 * Anthropic requires every assistant tool-call to be followed immediately by a
 * tool message containing the matching results. Persisted or dynamically
 * injected local-agent messages can occasionally violate that shape after
 * retries, aborts, or mid-turn message insertion. Normalize the transcript
 * before saving or sending it to a provider.
 */
export function sanitizeToolCallTranscript(
  messages: ModelMessage[],
): ModelMessage[] {
  const cleaned = messages.map(cleanMessage);
  const sanitized: ModelMessage[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const message = cleaned[i];

    // Tool messages are only valid when consumed by the immediately preceding
    // assistant tool-call branch below. A standalone tool result is dangling.
    if (message.role === "tool") {
      continue;
    }

    const toolCallIds = getToolCallIds(message);
    if (message.role !== "assistant" || toolCallIds.length === 0) {
      sanitized.push(message);
      continue;
    }

    const expectedToolCallIds = new Set(toolCallIds);
    const scanEnd = findNextAssistantIndex(cleaned, i + 1);
    const collectedToolResults = orderToolResultsByCallOrder(
      toolCallIds,
      collectToolResults(cleaned.slice(i + 1, scanEnd), expectedToolCallIds),
    );
    const completedToolCallIds = new Set(
      collectedToolResults.map((part) => part.toolCallId),
    );

    if (completedToolCallIds.size > 0) {
      const pairedAssistant = keepCompletedToolCalls(
        message,
        completedToolCallIds,
      );
      if (!pairedAssistant) {
        continue;
      }

      sanitized.push(pairedAssistant);
      sanitized.push(
        getCanonicalToolMessage(cleaned[i + 1], collectedToolResults) ??
          ({
            role: "tool",
            content: collectedToolResults,
          } as ModelMessage),
      );

      for (let j = i + 1; j < scanEnd; j++) {
        const interveningMessage = cleaned[j];
        if (interveningMessage.role !== "tool") {
          sanitized.push(interveningMessage);
        }
      }

      i = scanEnd - 1;
      continue;
    }

    const strippedAssistant = stripToolCalls(message);
    if (strippedAssistant) {
      sanitized.push(strippedAssistant);
    }
  }

  return sanitized;
}

function getCanonicalToolMessage(
  message: ModelMessage | undefined,
  collectedToolResults: ToolResultTranscriptPart[],
): ModelMessage | null {
  if (message?.role !== "tool" || !Array.isArray(message.content)) {
    return null;
  }

  if (message.content.length !== collectedToolResults.length) {
    return null;
  }

  return message.content.every(
    (part, index) => part === collectedToolResults[index],
  )
    ? message
    : null;
}

function findNextAssistantIndex(messages: ModelMessage[], startIndex: number) {
  for (let i = startIndex; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      return i;
    }
  }
  return messages.length;
}

function getToolCallIds(message: ModelMessage): string[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  const toolCallIds: string[] = [];
  for (const part of message.content) {
    if (isToolCallPart(part)) {
      toolCallIds.push(part.toolCallId);
    }
  }
  return toolCallIds;
}

function collectToolResults(
  messages: ModelMessage[],
  expectedToolCallIds: Set<string>,
): ToolResultTranscriptPart[] {
  const results: ToolResultTranscriptPart[] = [];
  const seenToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (
        isToolResultPart(part) &&
        expectedToolCallIds.has(part.toolCallId) &&
        !seenToolCallIds.has(part.toolCallId)
      ) {
        results.push(part);
        seenToolCallIds.add(part.toolCallId);
      }
    }
  }

  return results;
}

function orderToolResultsByCallOrder(
  toolCallIds: string[],
  toolResults: ToolResultTranscriptPart[],
): ToolResultTranscriptPart[] {
  const resultByToolCallId = new Map(
    toolResults.map((part) => [part.toolCallId, part]),
  );

  return toolCallIds.flatMap((toolCallId) => {
    const result = resultByToolCallId.get(toolCallId);
    return result ? [result] : [];
  });
}

function stripToolCalls(message: ModelMessage): ModelMessage | null {
  return keepCompletedToolCalls(message, new Set());
}

function keepCompletedToolCalls(
  message: ModelMessage,
  completedToolCallIds: Set<string>,
): ModelMessage | null {
  if (!Array.isArray(message.content)) {
    return message;
  }

  let didStripToolCall = false;
  const content = message.content.filter((part) => {
    if (!isToolCallPart(part)) {
      return true;
    }
    const shouldKeep = completedToolCallIds.has(part.toolCallId);
    didStripToolCall ||= !shouldKeep;
    return shouldKeep;
  });
  if (content.length === 0) {
    return null;
  }

  if (!didStripToolCall) {
    return message;
  }

  const cleaned = cleanMessage({ ...message, content } as ModelMessage);
  if (Array.isArray(cleaned.content) && cleaned.content.length === 0) {
    return null;
  }

  return cleaned;
}

export function isToolCallPart(part: unknown): part is ToolCallTranscriptPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as Record<string, unknown>).type === "tool-call" &&
    typeof (part as Record<string, unknown>).toolCallId === "string"
  );
}

export function isToolResultPart(
  part: unknown,
): part is ToolResultTranscriptPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as Record<string, unknown>).type === "tool-result" &&
    typeof (part as Record<string, unknown>).toolCallId === "string"
  );
}

export type ToolCallTranscriptPart = {
  type: "tool-call";
  toolCallId: string;
};

export type ToolResultTranscriptPart = {
  type: "tool-result";
  toolCallId: string;
};

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

  const sanitizedMessages = sanitizeToolCallTranscript(aiMessages);
  if (sanitizedMessages.length === 0) {
    return undefined;
  }

  const payload: AiMessagesJsonV6 = {
    messages: sanitizedMessages,
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
      return sanitizeToolCallTranscript(parsed);
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
      return sanitizeToolCallTranscript((parsed as AiMessagesJsonV6).messages);
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
