/**
 * Bidirectional XML <-> Tool Call translator for Local Agent v2
 *
 * Converts between AI SDK tool call format and XML strings for:
 * - Storage in database (messages.content)
 * - Rendering in UI (DyadMarkdownParser)
 * - Feeding back to model in native tool call format
 */

import type { ToolCallPart } from "ai";

// Escape XML content (less strict than attributes)
function escapeXmlContent(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wrap thinking text in think tags
 */
export function wrapThinking(text: string): string {
  return `<think>${escapeXmlContent(text)}</think>`;
}

// Regex patterns for parsing XML tags

interface ParsedToolCall {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

interface ParsedContent {
  type: "text" | "tool-call" | "tool-result" | "thinking";
  content?: string;
  toolCall?: ParsedToolCall;
  toolResult?: { toolCallId: string; result: unknown };
}

/**
 * Convert parsed content back to AI SDK message format with tool calls
 * for feeding historical messages back to the model
 */
export function parsedContentToToolCallParts(
  parsed: ParsedContent[],
): (ToolCallPart | { type: "text"; text: string })[] {
  const parts: (ToolCallPart | { type: "text"; text: string })[] = [];

  for (const item of parsed) {
    if (item.type === "text" && item.content) {
      parts.push({ type: "text", text: item.content });
    } else if (item.type === "tool-call" && item.toolCall) {
      parts.push({
        type: "tool-call",
        toolCallId: item.toolCall.toolCallId,
        toolName: item.toolCall.toolName,
        input: item.toolCall.args,
      });
    } else if (item.type === "thinking" && item.content) {
      // Thinking blocks are converted to text for context
      parts.push({ type: "text", text: `<think>${item.content}</think>` });
    }
  }

  return parts;
}
