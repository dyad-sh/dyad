import { messages } from "@/db/schema";
import type { Message } from "@/ipc/types/chat";

/**
 * Columns that are safe and useful to expose to the renderer.
 *
 * In particular, `aiMessagesJson` is intentionally omitted. It can contain a
 * second, multi-megabyte representation of an agent turn and is only needed by
 * the main-process LLM pipeline.
 */
export const rendererMessageColumns = {
  id: true,
  role: true,
  content: true,
  approvalState: true,
  sourceCommitHash: true,
  commitHash: true,
  requestId: true,
  maxTokensUsed: true,
  model: true,
  createdAt: true,
} as const;

type RendererMessageRow = Pick<
  typeof messages.$inferSelect,
  keyof typeof rendererMessageColumns
>;

export function toRendererMessage(message: RendererMessageRow): Message {
  return {
    id: message.id,
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
