import { messages } from "@/db/schema";
import type { Message } from "@/ipc/types/chat";
import { extractCompactionBlocks } from "@/ipc/handlers/compaction/compaction_utils";

/**
 * Columns that are safe and useful to expose to the renderer.
 *
 * In particular, `aiMessagesJson` is intentionally omitted. It can contain a
 * second, multi-megabyte representation of an agent turn and is only needed by
 * the main-process LLM pipeline.
 */
export const rendererMessageColumns = {
  id: true,
  chatTurnIntentId: true,
  role: true,
  content: true,
  approvalState: true,
  sourceCommitHash: true,
  commitHash: true,
  requestId: true,
  maxTokensUsed: true,
  model: true,
  createdAt: true,
  isCompactionSummary: true,
} as const;

export type RendererMessageRow = Pick<
  typeof messages.$inferSelect,
  keyof typeof rendererMessageColumns
>;

/** Keep model-history summaries in the DB, but do not display them twice. */
export function toRendererMessages(rows: RendererMessageRow[]): Message[] {
  const inlineMessages = rows
    .filter((row) => row.role === "assistant" && !row.isCompactionSummary)
    .map((row) => ({ row, blocks: extractCompactionBlocks(row.content) }))
    .filter(({ blocks }) => blocks.length > 0);
  return rows
    .filter((row) => {
      if (!row.isCompactionSummary) return true;
      const block = extractCompactionBlocks(row.content)[0];
      // IDs preserve insertion order even when pre-turn summaries are backdated.
      // Identical summaries in earlier turns must not hide this turn's indicator.
      const triggeringUser = rows.reduce<RendererMessageRow | undefined>(
        (latest, candidate) =>
          candidate.role === "user" &&
          candidate.id < row.id &&
          (!latest || candidate.id > latest.id)
            ? candidate
            : latest,
        undefined,
      );
      // Check the actual inline block: timestamps alone could hide the only
      // indicator if compaction completed but the turn was never persisted.
      return (
        !block ||
        !triggeringUser ||
        !inlineMessages.some(
          ({ row: inline, blocks }) =>
            inline.id > triggeringUser.id &&
            inline.id < row.id &&
            inline.createdAt.getTime() <= row.createdAt.getTime() &&
            blocks.includes(block),
        )
      );
    })
    .map(toRendererMessage);
}

export function toRendererMessage(message: RendererMessageRow): Message {
  return {
    id: message.id,
    chatTurnIntentId: message.chatTurnIntentId,
    role: message.role,
    content: message.content,
    approvalState: message.approvalState,
    sourceCommitHash: message.sourceCommitHash,
    commitHash: message.commitHash,
    requestId: message.requestId,
    totalTokens: message.maxTokensUsed,
    model: message.model,
    createdAt: message.createdAt,
  };
}
