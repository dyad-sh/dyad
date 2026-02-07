/**
 * Shared utilities for context compaction.
 */

/**
 * Filter messages to only include those after the latest compaction boundary.
 *
 * Uses ID-based filtering instead of position-based slicing because the
 * createdAt column has second precision (stored as Unix seconds). When
 * the compaction summary's timestamp rounds to a full second earlier,
 * it can sort before pre-compaction messages in the createdAt-ordered array,
 * causing slice() to include everything.
 *
 * Since message IDs are auto-incrementing, the compaction summary always has
 * a higher ID than all pre-compaction messages. The user message that triggered
 * compaction processing (and its placeholder) were inserted before the compaction
 * summary, so they have lower IDs — but they should be included.
 *
 * Strategy: find the last user message (by ID) inserted before the compaction
 * summary. This is the message whose processing triggered compaction. Include it,
 * all subsequent non-summary messages, and the compaction summary itself.
 */
export function getPostCompactionMessages<
  T extends { id: number; role: string; isCompactionSummary: boolean | null },
>(messages: T[]): T[] {
  // Find the latest compaction summary by highest ID
  const latestSummary = messages
    .filter((m) => m.isCompactionSummary)
    .sort((a, b) => b.id - a.id)[0];

  if (!latestSummary) {
    return messages;
  }

  // Find the last user message (by ID) before the compaction summary.
  // This is the message that triggered compaction processing.
  const triggeringUserMsg = messages
    .filter((m) => m.role === "user" && m.id < latestSummary.id)
    .sort((a, b) => b.id - a.id)[0];

  if (triggeringUserMsg) {
    // Include: the compaction summary + all messages with id >= triggering user message
    // (excluding older compaction summaries from prior compactions)
    return messages.filter(
      (m) =>
        m.id === latestSummary.id ||
        (m.id >= triggeringUserMsg.id && !m.isCompactionSummary),
    );
  }

  // No user message before compaction — include everything from summary onward by ID
  return messages.filter((m) => m.id >= latestSummary.id);
}
