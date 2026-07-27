import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";

import * as schema from "@/db/schema";
import { chats, messages } from "@/db/schema";
import {
  ensureIntentRecord,
  getAcceptedMessageId,
  markIntentAccepted,
} from "@/chat_stream/persistence";
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
}

export interface AcceptedChatTurn {
  userMessageId: number | null;
  authoritativeChatMode: StoredChatMode | null;
}

export function acceptChatTurn(
  database: ChatTurnDatabase,
  input: AcceptChatTurnInput,
): AcceptedChatTurn {
  if (input.chatTurnIntent) {
    ensureIntentRecord(input.chatTurnIntent);
  }
  if (
    input.chatTurnIntentId &&
    getAcceptedMessageId(input.chatTurnIntentId) !== undefined
  ) {
    return { userMessageId: null, authoritativeChatMode: null };
  }
  const accepted = database.transaction((tx) => {
    const insert = tx.insert(messages).values({
      chatId: input.chatId,
      role: "user",
      content: input.content,
      userInputRequestId: input.userInputRequestId,
    });
    const insertedUserMessage = (
      input.userInputRequestId
        ? insert.onConflictDoNothing({
            target: [messages.chatId, messages.userInputRequestId],
          })
        : insert
    )
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

    if (input.storedChatMode !== null) {
      return {
        userMessageId: insertedUserMessage.id,
        authoritativeChatMode: null,
      };
    }

    const latchedChat = tx
      .update(chats)
      .set({ chatMode: input.selectedChatMode })
      .where(and(eq(chats.id, input.chatId), isNull(chats.chatMode)))
      .returning({ chatMode: chats.chatMode })
      .get();
    if (latchedChat) {
      return {
        userMessageId: insertedUserMessage.id,
        authoritativeChatMode: latchedChat.chatMode,
      };
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
    return {
      userMessageId: insertedUserMessage.id,
      authoritativeChatMode: winningChat.chatMode,
    };
  });
  if (accepted.userMessageId !== null && input.chatTurnIntentId) {
    markIntentAccepted(input.chatTurnIntentId, accepted.userMessageId);
  }
  return accepted;
}
