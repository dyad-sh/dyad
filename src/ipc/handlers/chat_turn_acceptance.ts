import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  chats,
  chatQueueEntries,
  chatQueueState,
  chatTurnIntents,
  messages,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { ChatMode, StoredChatMode } from "@/lib/schemas";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";

type ChatTurnDatabase = Pick<
  BetterSQLite3Database<typeof schema>,
  "transaction"
>;

export interface AcceptChatTurnInput {
  chatId: number;
  storedChatMode: StoredChatMode | null;
  selectedChatMode: ChatMode;
  content: string;
  userInputRequestId?: string;
  chatTurnIntentId?: string;
  chatTurnIntent?: SerializableChatTurnIntent;
  sessionQueued?: boolean;
}

export interface AcceptedChatTurn {
  userMessageId: number | null;
  authoritativeChatMode: StoredChatMode | null;
}

export function acceptChatTurn(
  database: ChatTurnDatabase,
  input: AcceptChatTurnInput,
): AcceptedChatTurn {
  return database.transaction((tx) => {
    if (input.chatTurnIntent) {
      const existing = tx
        .select({
          chatId: chatTurnIntents.chatId,
          payloadHash: chatTurnIntents.payloadHash,
        })
        .from(chatTurnIntents)
        .where(eq(chatTurnIntents.intentId, input.chatTurnIntent.intentId))
        .get();
      if (
        existing &&
        (existing.chatId !== input.chatTurnIntent.chatId ||
          existing.payloadHash !== input.chatTurnIntent.payloadHash)
      ) {
        throw new DyadError(
          "Chat turn intent conflicts with its accepted payload",
          DyadErrorKind.Conflict,
        );
      }
      if (!existing) {
        tx.insert(chatTurnIntents)
          .values({
            intentId: input.chatTurnIntent.intentId,
            chatId: input.chatTurnIntent.chatId,
            payloadHash: input.chatTurnIntent.payloadHash,
            envelopeJson: JSON.stringify(input.chatTurnIntent),
            acceptance: "queued",
            recovery: "not-started",
          })
          .run();
      }
    }
    const insertedUserMessage = tx
      .insert(messages)
      .values({
        chatId: input.chatId,
        role: "user",
        content: input.content,
        userInputRequestId: input.userInputRequestId,
        chatTurnIntentId: input.chatTurnIntentId,
      })
      .onConflictDoNothing({
        target: input.chatTurnIntentId
          ? [messages.chatId, messages.chatTurnIntentId]
          : [messages.chatId, messages.userInputRequestId],
      })
      .returning({ id: messages.id })
      .get();

    if (!insertedUserMessage) {
      // Repair chats accepted before first-turn latching became atomic.
      tx.update(chats)
        .set({ chatMode: input.selectedChatMode })
        .where(and(eq(chats.id, input.chatId), isNull(chats.chatMode)))
        .run();
      return { userMessageId: null, authoritativeChatMode: null };
    }

    if (input.sessionQueued) {
      tx.update(chatQueueState)
        .set({ revision: sql`${chatQueueState.revision} + 1` })
        .where(eq(chatQueueState.chatId, input.chatId))
        .run();
    }

    if (input.storedChatMode !== null) {
      const accepted = {
        userMessageId: insertedUserMessage.id,
        authoritativeChatMode: null,
      };
      markIntentAccepted(tx, input.chatTurnIntentId, insertedUserMessage.id);
      return accepted;
    }

    const latchedChat = tx
      .update(chats)
      .set({ chatMode: input.selectedChatMode })
      .where(and(eq(chats.id, input.chatId), isNull(chats.chatMode)))
      .returning({ chatMode: chats.chatMode })
      .get();
    if (latchedChat) {
      const accepted = {
        userMessageId: insertedUserMessage.id,
        authoritativeChatMode: latchedChat.chatMode,
      };
      markIntentAccepted(tx, input.chatTurnIntentId, insertedUserMessage.id);
      return accepted;
    }

    const winningChat = tx
      .select({ chatMode: chats.chatMode })
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get();
    if (!winningChat) {
      throw new DyadError(
        `Chat not found: ${input.chatId}`,
        DyadErrorKind.NotFound,
      );
    }
    const accepted = {
      userMessageId: insertedUserMessage.id,
      authoritativeChatMode: winningChat.chatMode,
    };
    markIntentAccepted(tx, input.chatTurnIntentId, insertedUserMessage.id);
    return accepted;
  });
}

function markIntentAccepted(
  tx: Parameters<Parameters<ChatTurnDatabase["transaction"]>[0]>[0],
  intentId: string | undefined,
  acceptedMessageId: number,
): void {
  if (!intentId) return;
  tx.update(chatTurnIntents)
    .set({
      acceptance: "message-accepted",
      recovery: "started",
      acceptedMessageId,
      updatedAt: new Date(),
    })
    .where(eq(chatTurnIntents.intentId, intentId))
    .run();
  const queued = tx
    .select({
      chatId: chatQueueEntries.chatId,
      position: chatQueueEntries.position,
    })
    .from(chatQueueEntries)
    .where(eq(chatQueueEntries.intentId, intentId))
    .get();
  if (!queued) return;
  tx.delete(chatQueueEntries)
    .where(eq(chatQueueEntries.intentId, intentId))
    .run();
  tx.update(chatQueueEntries)
    .set({ position: sql`${chatQueueEntries.position} - 1` })
    .where(
      and(
        eq(chatQueueEntries.chatId, queued.chatId),
        sql`${chatQueueEntries.position} > ${queued.position}`,
      ),
    )
    .run();
  tx.update(chatQueueState)
    .set({ revision: sql`${chatQueueState.revision} + 1` })
    .where(eq(chatQueueState.chatId, queued.chatId))
    .run();
}
