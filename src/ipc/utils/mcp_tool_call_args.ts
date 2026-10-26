import {
  MCP_RESULT_MAX_BYTES,
  sanitizeMcpToolResult,
} from "@/ipc/utils/mcp_result_sanitizer";

export const MCP_CONSENT_PREVIEW_MAX_CHARS = 500;

export interface PreparedMcpToolCallArgs {
  /** Text stored in the `<dyad-mcp-tool-call>` body, at most 128 KB. */
  transcriptText: string;
  /** Bounded preview shown in the consent banner. */
  consentPreview: string;
  /** True when the transcript copy omits part of the arguments. */
  truncated: boolean;
}

/**
 * Bound the display copies of MCP tool-call arguments. Sandbox scripts can
 * pass arguments of any size, so the transcript gets the same 128 KB cap as
 * tool results. The tool itself always receives the original arguments.
 */
export function prepareMcpToolCallArgs(args: unknown): PreparedMcpToolCallArgs {
  // Walks at most the byte budget, so this never stringifies huge arguments.
  const sanitized = sanitizeMcpToolResult(args);
  let transcriptText = sanitized.serialized;
  if (!sanitized.truncated) {
    // Small enough to stringify: keep the pretty JSON stored before the cap.
    const pretty = JSON.stringify(args, null, 2);
    if (
      pretty !== undefined &&
      Buffer.byteLength(pretty, "utf8") <= MCP_RESULT_MAX_BYTES
    ) {
      transcriptText = pretty;
    }
  }
  const previewSource =
    typeof args === "string"
      ? args
      : Array.isArray(args)
        ? joinPrefix(args, MCP_CONSENT_PREVIEW_MAX_CHARS)
        : sanitized.serialized;
  return {
    transcriptText,
    consentPreview: previewSource.slice(0, MCP_CONSENT_PREVIEW_MAX_CHARS),
    truncated: sanitized.truncated,
  };
}

// Same output as `items.join(" ").slice(0, maxChars)` without building the
// whole joined string.
function joinPrefix(items: unknown[], maxChars: number): string {
  let out = "";
  for (let index = 0; index < items.length && out.length < maxChars; index++) {
    if (index > 0) out += " ";
    const item = items[index];
    out += (item == null ? "" : String(item)).slice(0, maxChars - out.length);
  }
  return out;
}
