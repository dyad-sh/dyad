import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { chatTurnIntents, messages } from "@/db/schema";
import { isCancelledResponseContent } from "@/shared/chatCancellation";
import type { ChatTurnTerminalOutcome } from "@/shared/chat_turn_outcome";

export type StoredTurnMessage = Pick<
  typeof messages.$inferSelect,
  "role" | "content" | "sourceCommitHash" | "commitHash" | "chatTurnIntentId"
>;

export type StoredTurnOutcome = ChatTurnTerminalOutcome | "unknown";

/**
 * How the turn started by user message `target` ended, from its durable turn
 * intent, else from a cancelled response with no commit right after it.
 */
export async function getStoredTurnOutcome(
  target: StoredTurnMessage,
  nextMessage?: StoredTurnMessage,
): Promise<StoredTurnOutcome> {
  if (target.chatTurnIntentId) {
    const intent = await db.query.chatTurnIntents.findFirst({
      columns: { terminalOutcome: true },
      where: eq(chatTurnIntents.intentId, target.chatTurnIntentId),
    });
    if (intent?.terminalOutcome) return intent.terminalOutcome;
  }

  if (
    nextMessage?.role === "assistant" &&
    !nextMessage.commitHash &&
    isCancelledResponseContent(nextMessage.content)
  ) {
    return "cancelled";
  }

  return "unknown";
}

/** {@link getStoredTurnOutcome} for user message `messageId` of `chatId`. */
export async function getStoredTurnOutcomeForMessage({
  chatId,
  messageId,
}: {
  chatId: number;
  messageId: number;
}): Promise<StoredTurnOutcome> {
  const columns = {
    role: true,
    content: true,
    sourceCommitHash: true,
    commitHash: true,
    chatTurnIntentId: true,
  } as const;
  const target = await db.query.messages.findFirst({
    columns,
    where: and(eq(messages.chatId, chatId), eq(messages.id, messageId)),
  });
  if (!target || target.role !== "user") return "unknown";
  const nextMessage = await db.query.messages.findFirst({
    columns,
    where: and(eq(messages.chatId, chatId), gt(messages.id, messageId)),
    orderBy: (messages, { asc }) => [asc(messages.id)],
  });
  return getStoredTurnOutcome(target, nextMessage);
}
