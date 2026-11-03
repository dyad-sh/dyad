/**
 * MCP arguments and results are copied into the chat transcript for display.
 * The tool and the model always get the full values; only the transcript copy
 * is bounded, because the renderer and the stored message grow with it.
 */

/** Largest MCP argument or result written to the transcript as-is. */
export const MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS = 64_000;
/** Total MCP payload characters one turn may write to the transcript. */
export const MCP_TRANSCRIPT_TURN_BUDGET_CHARS = 2_000_000;
/** Preview size kept for each payload once the turn budget is spent. */
export const MCP_TRANSCRIPT_MIN_PREVIEW_CHARS = 1_000;

/** Characters of MCP payload already written to the transcript this turn. */
export interface McpTranscriptBudget {
  usedChars: number;
}

export interface McpTranscriptPreview {
  text: string;
  /** Original length when `text` is a prefix, otherwise undefined. */
  truncatedFrom?: number;
}

export function createMcpTranscriptBudget(): McpTranscriptBudget {
  return { usedChars: 0 };
}

export function previewMcpPayload(
  text: string,
  budget: McpTranscriptBudget,
): McpTranscriptPreview {
  const remaining = MCP_TRANSCRIPT_TURN_BUDGET_CHARS - budget.usedChars;
  const limit = Math.min(
    MCP_TRANSCRIPT_PAYLOAD_MAX_CHARS,
    Math.max(MCP_TRANSCRIPT_MIN_PREVIEW_CHARS, remaining),
  );
  if (text.length <= limit) {
    budget.usedChars += text.length;
    return { text };
  }
  let end = limit;
  // Prevents the case where the cut splits a surrogate pair.
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end--;
  budget.usedChars += end;
  return { text: text.slice(0, end), truncatedFrom: text.length };
}

/** XML attribute marking a truncated payload, or "" when it is complete. */
export function truncatedFromAttr(preview: McpTranscriptPreview): string {
  return preview.truncatedFrom === undefined
    ? ""
    : ` truncated-from="${preview.truncatedFrom}"`;
}

/**
 * XML attribute marking a result that `sanitizeMcpToolResult` cut before the
 * agent received it, or "" when the agent got the whole result.
 */
export function toolTruncatedAttr(truncated: boolean): string {
  return truncated ? ` tool-truncated="true"` : "";
}
