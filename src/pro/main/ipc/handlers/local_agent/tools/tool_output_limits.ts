/**
 * Source-level caps for tool outputs that can otherwise reach an LLM context
 * without any bound.
 *
 * The AI SDK step loop re-sends the whole accumulated transcript on every
 * step, so an unbounded tool result is not paid for once — it is paid for
 * again on every following request of the turn. The request-time budget
 * (`pruneRootMessages` / `pruneSubagentMessages`) trims what the provider
 * sees, but the raw value still lands in the in-memory transcript and in the
 * persisted message history. Bounding it at the source fixes both.
 */

/** Maximum characters returned for a database schema dump. */
export const MAX_DATABASE_SCHEMA_CHARS = 20_000;

/** Maximum characters returned for a SQL result set. */
export const MAX_SQL_RESULT_CHARS = 20_000;

/** Maximum characters returned for a type-check report. */
export const MAX_TYPE_CHECK_OUTPUT_CHARS = 30_000;

/** Maximum characters returned for a log listing. */
export const MAX_LOG_OUTPUT_CHARS = 40_000;

/** Maximum characters returned for a file listing. */
export const MAX_FILE_LIST_CHARS = 40_000;

/** Maximum characters returned for a project-info payload. */
export const MAX_PROJECT_INFO_CHARS = 20_000;

/**
 * Hard ceiling on the characters of root chat history handed to the model.
 *
 * The compaction threshold is a token budget that can legitimately reach a
 * million characters before compaction fires. This is a much smaller bound
 * applied to the history that is actually sent, so a long-running chat cannot
 * ship an unbounded transcript on every step.
 */
export const MAX_ROOT_HISTORY_CHARS = 200_000;

/**
 * Maximum characters accepted for a SQL query. The query travels back to the
 * model on every step of the turn as part of the assistant tool call.
 */
export const MAX_SQL_QUERY_CHARS = 20_000;

/**
 * Maximum characters of TypeScript declarations returned for a single MCP
 * tool, and for the whole block of declarations.
 */
export const MAX_MCP_TOOL_DECLARATION_CHARS = 2_000;
export const MAX_MCP_TYPE_DEFS_BLOCK_CHARS = 12_000;

/**
 * Bounds a tool's textual output, keeping the head and the tail so both the
 * beginning of a listing and its end survive.
 */
export function boundToolOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const marker = `\n\n[... output truncated to ${maxChars} characters ...]\n\n`;
  const available = Math.max(0, maxChars - marker.length);
  if (available <= 0) {
    return value.slice(0, maxChars);
  }
  const headChars = Math.ceil(available * 0.7);
  const tailChars = available - headChars;
  if (tailChars <= 0) {
    return `${value.slice(0, available)}${marker}`;
  }
  return `${value.slice(0, headChars)}${marker}${value.slice(
    value.length - tailChars,
  )}`;
}
