import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "../ipc_types";
import type { ModelMessage } from "ai";

import { findLanguageModel } from "./findLanguageModel";

// Estimate tokens — conservative ratio for code/XML content (2.8 chars/token).
// Standard English is ~4 chars/token, but code with XML tags, short variable
// names, and JSON schemas typically tokenizes at 2.5-3.0 chars/token with Claude.
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 2.8);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0,
  );
};

/**
 * Estimate the total input tokens for an AI request.
 */
export function estimateRequestTokens(
  systemPrompt: string,
  chatMessages: ModelMessage[],
): number {
  let total = estimateTokens(systemPrompt);
  for (const msg of chatMessages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && typeof part.text === "string") {
          total += estimateTokens(part.text);
        }
      }
    }
    // Per-message overhead (role, formatting)
    total += 4;
  }
  return total;
}

/**
 * Sanitize messages that contain tool_use / tool_result content parts.
 * Anthropic requires every tool_use block to have a matching tool_result
 * in the immediately following message. When we trim history, those pairs
 * can break. This function converts complex tool messages into plain
 * text equivalents so they can be safely trimmed without API errors.
 */
export function sanitizeToolMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((msg) => {
    // If content is a string, nothing to sanitize
    if (typeof msg.content === "string") return msg;

    // If content is an array, check for tool-related parts
    if (Array.isArray(msg.content)) {
      const hasToolParts = msg.content.some(
        (part: any) =>
          part.type === "tool-call" ||
          part.type === "tool-result" ||
          part.type === "tool_use" ||
          part.type === "tool_result",
      );
      if (!hasToolParts) return msg;

      // Convert tool parts to text summaries
      const textParts: string[] = [];
      for (const part of msg.content as any[]) {
        if (part.type === "text" && part.text) {
          textParts.push(part.text);
        } else if (
          part.type === "tool-call" ||
          part.type === "tool_use"
        ) {
          textParts.push(
            `[Used tool: ${part.toolName || part.name || "unknown"}]`,
          );
        } else if (
          part.type === "tool-result" ||
          part.type === "tool_result"
        ) {
          const resultText =
            typeof part.result === "string"
              ? part.result.slice(0, 200)
              : typeof part.content === "string"
                ? part.content.slice(0, 200)
                : "[result]";
          textParts.push(`[Tool result: ${resultText}]`);
        }
      }

      const summaryContent = textParts.join("\n");

      // ToolModelMessage (role: 'tool') requires content: Array<ToolResultPart>,
      // so we must change `role` to 'user' when converting to string content.
      // AssistantModelMessage accepts string content, so role stays 'assistant'.
      if (msg.role === "tool") {
        return {
          role: "user" as const,
          content: summaryContent || "[Tool result]",
        };
      }

      return {
        ...msg,
        content: summaryContent || (typeof msg.content === "string" ? msg.content : ""),
      } as ModelMessage;
    }

    return msg;
  });
}

/**
 * Trim chat messages from the oldest end to fit within a token budget.
 * Preserves the codebase prefix messages (first 2) and the latest user message.
 * Returns a new array — does not mutate the input.
 */
export function trimMessagesToFitBudget(
  systemPrompt: string,
  chatMessages: ModelMessage[],
  maxInputTokens: number,
): ModelMessage[] {
  // Always sanitize tool_use/tool_result messages. This converts them to
  // plain text which: (a) prevents broken tool pairs when trimming removes
  // messages, and (b) ensures stored messages from older AI SDK versions
  // always conform to the current ModelMessage Zod schema.
  const safeChatMessages = sanitizeToolMessages(chatMessages);
  let currentTokens = estimateRequestTokens(systemPrompt, safeChatMessages);

  if (currentTokens <= maxInputTokens) {
    return safeChatMessages;
  }

  const trimmed = [...safeChatMessages];

  // The first 2 messages are codebase prefix (user + assistant "OK, got it"),
  // and the last 1-2 are the current user prompt. We trim from the middle.
  const protectedStart = Math.min(2, trimmed.length);
  const protectedEnd = 1;

  // Remove oldest history messages (from index protectedStart) until we fit
  while (
    currentTokens > maxInputTokens &&
    trimmed.length > protectedStart + protectedEnd
  ) {
    const removed = trimmed.splice(protectedStart, 1)[0];
    if (removed) {
      if (typeof removed.content === "string") {
        currentTokens -= estimateTokens(removed.content) + 4;
      } else {
        currentTokens -= 50; // rough estimate for non-string
      }
    }
  }

  // Last resort: if history is exhausted but code prefix is too large, truncate it
  if (currentTokens > maxInputTokens && trimmed.length > 0) {
    const codebaseMsgIdx = trimmed.findIndex(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        (m.content.includes("<joy-file") || m.content.includes("This is my codebase")),
    );
    if (codebaseMsgIdx >= 0) {
      const msg = trimmed[codebaseMsgIdx];
      const content = typeof msg.content === "string" ? msg.content : "";
      const excess = currentTokens - maxInputTokens;
      const charsToRemove = excess * 4 + 200; // 4 chars/token + margin
      if (charsToRemove < content.length) {
        // Truncate codebase content, keeping the beginning (file tree / most important files)
        trimmed[codebaseMsgIdx] = {
          ...msg,
          content:
            content.slice(0, content.length - charsToRemove) +
            "\n[Codebase truncated to fit token budget]",
        };
        currentTokens -= excess;
      } else {
        // Codebase is basically the entire budget — replace with minimal summary
        trimmed[codebaseMsgIdx] = {
          ...msg,
          content: "[Codebase context omitted to fit token budget. Refer to file paths in the conversation.]",
        };
        currentTokens = estimateRequestTokens(systemPrompt, trimmed);
      }
    }
  }

  return trimmed;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

export async function getContextWindow() {
  const settings = readSettings();
  const modelOption = await findLanguageModel(settings.selectedModel);
  return modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

export async function getMaxTokens(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.maxOutputTokens ?? undefined;
}

export async function getTemperature(
  model: LargeLanguageModel,
): Promise<number> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.temperature ?? 0;
}

// ---------------------------------------------------------------------------
// Conversation history compression
// ---------------------------------------------------------------------------

/**
 * Build a compressed chat message array by summarising old messages
 * and keeping the most recent ones verbatim.
 *
 * Layout: [...prefixMessages, summaryExchange?, ...recentMessages]
 */
export function buildCompressedChatMessages(
  prefixMessages: readonly ModelMessage[],
  historyMessages: ModelMessage[],
  maxHistoryTokens: number,
  recentCount = 2,
): ModelMessage[] {
  const historyTokens = historyMessages.reduce((sum, m) => {
    const c =
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(c) + 4;
  }, 0);

  // No compression needed — history fits or is short enough
  if (
    historyTokens <= maxHistoryTokens ||
    historyMessages.length <= recentCount
  ) {
    return [...prefixMessages, ...historyMessages];
  }

  const recent = historyMessages.slice(-recentCount);
  const old = historyMessages.slice(0, -recentCount);

  const summaryLines: string[] = [];
  for (const msg of old) {
    const content = typeof msg.content === "string" ? msg.content : "";
    if (msg.role === "user") {
      const line = compressExtractUserIntent(content);
      if (line) summaryLines.push(`U:${line}`);
    } else {
      const line = compressExtractActions(content);
      if (line) summaryLines.push(`A:${line}`);
    }
  }

  const summaryText =
    summaryLines.length > 0
      ? `[Summary of ${old.length} earlier messages]\n${summaryLines.join("\n")}`
      : "";

  // Budget: whatever is left after reserving space for the recent messages
  const recentTokens = recent.reduce((sum, m) => {
    const c =
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(c) + 4;
  }, 0);
  const SUMMARY_HARD_CAP = 2_000; // Never exceed 2k tokens for summary
  const summaryBudget = Math.min(
    Math.max(maxHistoryTokens - recentTokens, 500),
    SUMMARY_HARD_CAP,
  );
  const finalSummary =
    estimateTokens(summaryText) > summaryBudget
      ? summaryText.slice(0, summaryBudget * 4 - 3) + "..."
      : summaryText;

  if (!finalSummary) return [...prefixMessages, ...recent];

  const summaryExchange: ModelMessage[] = [
    { role: "user" as const, content: finalSummary },
    { role: "assistant" as const, content: "OK." },
  ];

  return [...prefixMessages, ...summaryExchange, ...recent];
}

function compressExtractUserIntent(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (
      line.startsWith("<") ||
      line.startsWith("```") ||
      line.startsWith("import ")
    )
      continue;
    return line.length > 80 ? `${line.slice(0, 77)}...` : line;
  }
  return lines[0]?.slice(0, 80) ?? "";
}

function compressExtractActions(text: string): string {
  const parts: string[] = [];
  const writes = [...text.matchAll(/<joy-write\s+path="([^"]+)"/g)].map(
    (m) => m[1],
  );
  if (writes.length > 0) {
    parts.push(
      `wrote ${writes.slice(0, 5).join(", ")}${
        writes.length > 5 ? ` +${writes.length - 5} more` : ""
      }`,
    );
  }
  const dep = text.match(/<joy-add-dependency\s+packages="([^"]+)"/);
  if (dep) parts.push(`added ${dep[1]}`);
  const dels = [...text.matchAll(/<joy-delete\s+path="([^"]+)"/g)].map(
    (m) => m[1],
  );
  if (dels.length > 0) parts.push(`deleted ${dels.join(", ")}`);
  if (parts.length > 0) return parts.join("; ");
  return compressExtractUserIntent(text);
}
