/**
 * Bidirectional XML <-> Tool Call translator for Local Agent v2
 *
 * Converts between AI SDK tool call format and XML strings for:
 * - Storage in database (messages.content)
 * - Rendering in UI (DyadMarkdownParser)
 * - Feeding back to model in native tool call format
 */

import type { ToolCallPart } from "ai";

// Escape XML special characters in attribute values
function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Escape XML content (less strict than attributes)
function escapeXmlContent(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert an AI SDK tool call to XML string for storage/display
 */
export function toolCallToXml(toolCall: {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}): string {
  const { toolName, args } = toolCall;

  switch (toolName) {
    case "write_file":
      return `<dyad-write path="${escapeXmlAttr(String(args.path ?? ""))}" description="${escapeXmlAttr(String(args.description ?? ""))}">
${args.content ?? ""}
</dyad-write>`;

    case "delete_file":
      return `<dyad-delete path="${escapeXmlAttr(String(args.path ?? ""))}"></dyad-delete>`;

    case "rename_file":
      return `<dyad-rename from="${escapeXmlAttr(String(args.from ?? ""))}" to="${escapeXmlAttr(String(args.to ?? ""))}"></dyad-rename>`;

    case "add_dependency":
      const packages = Array.isArray(args.packages)
        ? args.packages.join(" ")
        : String(args.packages ?? "");
      return `<dyad-add-dependency packages="${escapeXmlAttr(packages)}"></dyad-add-dependency>`;

    case "execute_sql":
      return `<dyad-execute-sql description="${escapeXmlAttr(String(args.description ?? ""))}">
${args.query ?? ""}
</dyad-execute-sql>`;

    case "search_replace":
      const operations = `<<<<<<< SEARCH\n${args.search ?? ""}\n=======\n${args.replace ?? ""}\n>>>>>>> REPLACE`;
      return `<dyad-search-replace path="${escapeXmlAttr(String(args.path ?? ""))}" description="${escapeXmlAttr(String(args.description ?? ""))}">
${operations}
</dyad-search-replace>`;

    case "read_file":
      return `<dyad-read path="${escapeXmlAttr(String(args.path ?? ""))}"></dyad-read>`;

    case "list_files":
      const dir = args.directory
        ? ` directory="${escapeXmlAttr(String(args.directory))}"`
        : "";
      return `<dyad-list-files${dir}></dyad-list-files>`;

    case "get_database_schema":
      return `<dyad-database-schema></dyad-database-schema>`;

    case "set_chat_summary":
      return `<dyad-chat-summary>${escapeXmlContent(String(args.summary ?? ""))}</dyad-chat-summary>`;

    default:
      // For unknown tools (e.g., MCP tools), use a generic format
      return `<dyad-tool-call tool="${escapeXmlAttr(toolName)}">
${JSON.stringify(args, null, 2)}
</dyad-tool-call>`;
  }
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
