/**
 * Bidirectional XML <-> Tool Call translator for Local Agent v2
 *
 * Converts between AI SDK tool call format and XML strings for:
 * - Storage in database (messages.content)
 * - Rendering in UI (DyadMarkdownParser)
 * - Feeding back to model in native tool call format
 */

import type { ToolCallPart, } from "ai";

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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      return `<dyad-search-replace path="${escapeXmlAttr(String(args.path ?? ""))}" description="${escapeXmlAttr(String(args.description ?? ""))}">
${args.operations ?? ""}
</dyad-search-replace>`;

    case "read_file":
      return `<dyad-read path="${escapeXmlAttr(String(args.path ?? ""))}"></dyad-read>`;

    case "list_files":
      const dir = args.directory ? ` directory="${escapeXmlAttr(String(args.directory))}"` : "";
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
 * Convert a tool result to XML for display
 */
export function toolResultToXml(
  toolName: string,
  result: unknown,
  isError: boolean = false,
): string {
  const resultStr =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);

  if (isError) {
    return `<dyad-tool-error tool="${escapeXmlAttr(toolName)}">${escapeXmlContent(resultStr)}</dyad-tool-error>`;
  }

  // For read operations, the result is shown inline with the tag
  // For write operations, we show a success indicator
  switch (toolName) {
    case "read_file":
      // Result is shown as content of dyad-read tag (already closed)
      return ""; // Content was already in the tool call

    case "list_files":
    case "get_database_schema":
      // These show their results inline
      return "";

    case "write_file":
    case "delete_file":
    case "rename_file":
    case "search_replace":
    case "add_dependency":
    case "execute_sql":
    case "set_chat_summary":
      // Write operations don't need result display
      return "";

    default:
      // Unknown tools show their result
      return `<dyad-tool-result tool="${escapeXmlAttr(toolName)}">${escapeXmlContent(resultStr)}</dyad-tool-result>`;
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
 * Parse XML content back to structured format for feeding to model
 * This is used when loading messages from DB to reconstruct tool calls
 */
export function parseXmlToToolCalls(content: string): ParsedContent[] {
  const results: ParsedContent[] = [];
  let lastIndex = 0;
  let idCounter = 0;

  const generateId = () => `parsed-${idCounter++}`;

  // Combined pattern to find all tags in order
  const allTagsPattern =
    /<(dyad-write|dyad-delete|dyad-rename|dyad-add-dependency|dyad-execute-sql|dyad-search-replace|dyad-read|dyad-list-files|dyad-database-schema|dyad-chat-summary|think)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;

  let match;
  while ((match = allTagsPattern.exec(content)) !== null) {
    // Add any text before this tag
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        results.push({ type: "text", content: text });
      }
    }

    const fullMatch = match[0];
    const tagName = match[1];

    // Parse the specific tag
    const parsed = parseSpecificTag(tagName, fullMatch, generateId);
    if (parsed) {
      results.push(parsed);
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add any remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) {
      results.push({ type: "text", content: text });
    }
  }

  return results;
}

function parseSpecificTag(
  tagName: string,
  fullMatch: string,
  generateId: () => string,
): ParsedContent | null {
  switch (tagName) {
    case "dyad-write": {
      const m =
        /<dyad-write\s+path="([^"]*)"(?:\s+description="([^"]*)")?>([\s\S]*?)<\/dyad-write>/.exec(
          fullMatch,
        );
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "write_file",
            toolCallId: generateId(),
            args: { path: m[1], description: m[2] || "", content: m[3].trim() },
          },
        };
      }
      break;
    }
    case "dyad-delete": {
      const m = /<dyad-delete\s+path="([^"]*)">/.exec(fullMatch);
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "delete_file",
            toolCallId: generateId(),
            args: { path: m[1] },
          },
        };
      }
      break;
    }
    case "dyad-rename": {
      const m = /<dyad-rename\s+from="([^"]*)"\s+to="([^"]*)">/.exec(fullMatch);
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "rename_file",
            toolCallId: generateId(),
            args: { from: m[1], to: m[2] },
          },
        };
      }
      break;
    }
    case "dyad-add-dependency": {
      const m = /<dyad-add-dependency\s+packages="([^"]*)">/.exec(fullMatch);
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "add_dependency",
            toolCallId: generateId(),
            args: { packages: m[1].split(" ").filter(Boolean) },
          },
        };
      }
      break;
    }
    case "dyad-execute-sql": {
      const m =
        /<dyad-execute-sql(?:\s+description="([^"]*)")?>([\s\S]*?)<\/dyad-execute-sql>/.exec(
          fullMatch,
        );
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "execute_sql",
            toolCallId: generateId(),
            args: { description: m[1] || "", query: m[2].trim() },
          },
        };
      }
      break;
    }
    case "dyad-search-replace": {
      const m =
        /<dyad-search-replace\s+path="([^"]*)"(?:\s+description="([^"]*)")?>([\s\S]*?)<\/dyad-search-replace>/.exec(
          fullMatch,
        );
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "search_replace",
            toolCallId: generateId(),
            args: { path: m[1], description: m[2] || "", operations: m[3].trim() },
          },
        };
      }
      break;
    }
    case "dyad-read": {
      const m = /<dyad-read\s+path="([^"]*)">/.exec(fullMatch);
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "read_file",
            toolCallId: generateId(),
            args: { path: m[1] },
          },
        };
      }
      break;
    }
    case "dyad-list-files": {
      const m = /<dyad-list-files(?:\s+directory="([^"]*)")?>/. exec(fullMatch);
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "list_files",
            toolCallId: generateId(),
            args: m[1] ? { directory: m[1] } : {},
          },
        };
      }
      break;
    }
    case "dyad-database-schema": {
      return {
        type: "tool-call",
        toolCall: {
          toolName: "get_database_schema",
          toolCallId: generateId(),
          args: {},
        },
      };
    }
    case "dyad-chat-summary": {
      const m = /<dyad-chat-summary>([\s\S]*?)<\/dyad-chat-summary>/.exec(
        fullMatch,
      );
      if (m) {
        return {
          type: "tool-call",
          toolCall: {
            toolName: "set_chat_summary",
            toolCallId: generateId(),
            args: { summary: m[1].trim() },
          },
        };
      }
      break;
    }
    case "think": {
      const m = /<think>([\s\S]*?)<\/think>/.exec(fullMatch);
      if (m) {
        return {
          type: "thinking",
          content: m[1],
        };
      }
      break;
    }
  }
  return null;
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
        args: item.toolCall.args,
      });
    } else if (item.type === "thinking" && item.content) {
      // Thinking blocks are converted to text for context
      parts.push({ type: "text", text: `<think>${item.content}</think>` });
    }
  }

  return parts;
}

