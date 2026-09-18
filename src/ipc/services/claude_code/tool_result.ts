import {
  ContentBlockSchema,
  type CallToolResult,
  type ContentBlock,
} from "@modelcontextprotocol/sdk/types.js";
import type { UserMessageContentPart } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { sanitizeMcpToolResult } from "@/ipc/utils/mcp_result_sanitizer";

/** Keep media as media. URLs remain links rather than being fetched with new
 * ambient authority; bounded inline images are passed through losslessly. */
export function toMcpToolResult(
  value: unknown,
  additions: UserMessageContentPart[],
  isError = false,
): CallToolResult {
  // External MCP callbacks return bounded serialized JSON for both backends.
  // Recover its typed content without granting any additional fetch authority.
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.content))
        value = parsed;
    } catch {
      /* Plain tool text. */
    }
  }
  const safe = sanitizeMcpToolResult(value);
  const normalized = safe.value;
  const content: ContentBlock[] = [];
  if (
    typeof normalized === "object" &&
    normalized !== null &&
    "content" in normalized &&
    Array.isArray(normalized.content)
  ) {
    for (const part of normalized.content) {
      if (part?.type === "text" && typeof part.text === "string")
        content.push({ type: "text", text: part.text });
      else if (
        part?.type === "image" &&
        typeof part.data === "string" &&
        typeof part.mimeType === "string" &&
        !safe.truncated
      )
        content.push({
          type: "image",
          data: part.data,
          mimeType: part.mimeType,
        });
      else {
        const typed = ContentBlockSchema.safeParse(part);
        if (typed.success && !safe.truncated) content.push(typed.data);
        else
          content.push({
            type: "text",
            text: sanitizeMcpToolResult(part).serialized,
          });
      }
    }
  } else if (
    typeof normalized === "object" &&
    normalized !== null &&
    "type" in normalized &&
    normalized.type === "text" &&
    "value" in normalized
  ) {
    content.push({ type: "text", text: String(normalized.value) });
  } else content.push({ type: "text", text: safe.serialized });
  if (safe.truncated)
    content.push({
      type: "text",
      text: "[Tool result truncated to the Dyad safety limit.]",
    });
  let imageBytes = 0;
  for (const part of additions) {
    if (part.type === "text")
      content.push({
        type: "text",
        text: sanitizeMcpToolResult(part.text).serialized,
      });
    else {
      const data =
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
          part.url,
        );
      if (data && (imageBytes += data[2].length) <= 8 * 1024 * 1024)
        content.push({ type: "image", mimeType: data[1], data: data[2] });
      else if (data)
        content.push({
          type: "text",
          text: "[Image omitted: result exceeds the 8 MiB image budget.]",
        });
      else
        content.push({
          type: "resource_link",
          name: "Image attachment",
          uri: part.url,
        });
    }
  }
  return { isError, content };
}
