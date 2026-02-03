/**
 * Core compaction logic for mid-stream context window management.
 *
 * Pure/testable functions that estimate token usage, decide when to compact,
 * partition messages, and build compacted message arrays.
 */

import type { ModelMessage } from "ai";

/**
 * Estimate tokens for a string (4 chars per token heuristic).
 */
function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the total token count for an array of ModelMessages.
 *
 * Walks each message and estimates tokens by content type:
 * - String content: 4 chars/token
 * - TextPart[]: concatenate .text fields
 * - ToolCallPart: JSON.stringify(input) + 20 token overhead
 * - ToolResultPart: JSON.stringify(output) + 20 token overhead
 * - ImagePart: flat 1000 tokens per image
 * - ~4 tokens/message for role/structure overhead
 */
export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;

  for (const msg of messages) {
    // Role/structure overhead per message
    total += 4;

    if (typeof msg.content === "string") {
      total += estimateStringTokens(msg.content);
      continue;
    }

    if (!Array.isArray(msg.content)) {
      continue;
    }

    for (const part of msg.content) {
      switch (part.type) {
        case "text":
          total += estimateStringTokens(part.text);
          break;
        case "image":
          total += 1000;
          break;
        case "file":
          // Estimate based on data size if string, otherwise flat cost
          if (typeof part.data === "string") {
            total += estimateStringTokens(part.data);
          } else {
            total += 500;
          }
          break;
        case "tool-call":
          total += estimateStringTokens(JSON.stringify(part.input)) + 20;
          break;
        case "tool-result":
          total += estimateStringTokens(JSON.stringify(part.output)) + 20;
          break;
        case "reasoning":
          total += estimateStringTokens(part.text);
          break;
        default:
          // Unknown part type, small overhead
          total += 10;
          break;
      }
    }
  }

  return total;
}

/**
 * Returns true when estimated tokens >= contextWindow * threshold.
 */
export function shouldCompact(params: {
  messages: ModelMessage[];
  contextWindow: number;
  threshold?: number;
}): boolean {
  const { messages, contextWindow, threshold = 0.75 } = params;
  const estimated = estimateModelMessagesTokens(messages);
  return estimated >= contextWindow * threshold;
}

/**
 * Splits messages into two groups: those to compact (summarize) and those to preserve.
 *
 * Rules:
 * - Always preserves the first user message (original intent)
 * - Keeps the last `preserveRecentCount` messages intact
 * - Never splits a tool-call / tool-result pair across the boundary
 * - If fewer messages than preserveRecentCount + 1, nothing to compact
 */
export function partitionMessagesForCompaction(
  messages: ModelMessage[],
  preserveRecentCount = 10,
): { toCompact: ModelMessage[]; toPreserve: ModelMessage[] } {
  // Need at least preserveRecentCount + 1 (for the first user message) + 1 more to compact
  if (messages.length <= preserveRecentCount + 1) {
    return { toCompact: [], toPreserve: messages };
  }

  // Start with a split point that preserves the last N messages
  let splitIndex = messages.length - preserveRecentCount;

  // Adjust split point to avoid breaking tool-call / tool-result pairs.
  // A tool-result message (role: "tool") should stay with the preceding assistant
  // message that contains the tool-call. Walk the boundary backwards if needed.
  while (splitIndex > 1 && isToolResultMessage(messages[splitIndex])) {
    splitIndex--;
  }

  // If we pushed splitIndex too far back, there's nothing meaningful to compact
  if (splitIndex <= 1) {
    return { toCompact: [], toPreserve: messages };
  }

  // Always preserve the first user message in the toPreserve set
  const firstUserMessage = messages[0];
  const toCompact = messages.slice(1, splitIndex);
  const toPreserve = [firstUserMessage, ...messages.slice(splitIndex)];

  return { toCompact, toPreserve };
}

/**
 * Checks if a message is a tool-result message (role: "tool").
 */
function isToolResultMessage(msg: ModelMessage): boolean {
  return msg.role === "tool";
}

/**
 * Serializes compactable messages into a text representation for the summarizer.
 * Large tool results (>2000 chars) are truncated.
 */
export function buildCompactionPrompt(
  toCompact: ModelMessage[],
): ModelMessage[] {
  const MAX_TOOL_RESULT_LENGTH = 2000;

  const lines: string[] = [];

  for (const msg of toCompact) {
    const role = msg.role.toUpperCase();

    if (typeof msg.content === "string") {
      lines.push(`[${role}]: ${msg.content}`);
      continue;
    }

    if (!Array.isArray(msg.content)) {
      lines.push(`[${role}]: (empty)`);
      continue;
    }

    const parts: string[] = [];
    for (const part of msg.content) {
      switch (part.type) {
        case "text":
          parts.push(part.text);
          break;
        case "tool-call":
          parts.push(
            `[Tool Call: ${part.toolName}(${truncate(JSON.stringify(part.input), MAX_TOOL_RESULT_LENGTH)})]`,
          );
          break;
        case "tool-result": {
          const resultStr = JSON.stringify(part.output);
          parts.push(
            `[Tool Result for ${part.toolName}: ${truncate(resultStr, MAX_TOOL_RESULT_LENGTH)}]`,
          );
          break;
        }
        case "image":
          parts.push("[Image]");
          break;
        case "file":
          parts.push("[File]");
          break;
        case "reasoning":
          parts.push(
            `[Reasoning: ${truncate(part.text, MAX_TOOL_RESULT_LENGTH)}]`,
          );
          break;
        default:
          parts.push(`[${part.type}]`);
          break;
      }
    }

    lines.push(`[${role}]: ${parts.join("\n")}`);
  }

  return [
    {
      role: "user",
      content: lines.join("\n\n"),
    },
  ];
}

/**
 * Returns [summaryUserMessage, ...toPreserve] where the summary is a user message
 * prefixed with context about it being a summary.
 */
export function buildCompactedMessages(
  summary: string,
  toPreserve: ModelMessage[],
): ModelMessage[] {
  const summaryMessage: ModelMessage = {
    role: "user",
    content: `[Conversation Summary — use for context, focus on recent messages for current task]\n\n${summary}`,
  };

  return [summaryMessage, ...toPreserve];
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "... (truncated)";
}
