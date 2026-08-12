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
import type { ChatMode, ModelSelection, StoredChatMode } from "@/lib/schemas";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";

type ChatTurnDatabase = Pick<
  BetterSQLite3Database<typeof schema>,
  "transaction"
>;

export interface AcceptChatTurnInput {
  chatId: number;
  storedChatMode: StoredChatMode | null;
  selectedChatMode: ChatMode;
  selectedModel: ModelSelection;
  content: string;
  userInputRequestId?: string;
  chatTurnIntentId?: string;
  chatTurnIntent?: SerializableChatTurnIntent;
}

export interface AcceptedChatTurn {
  userMessageId: number | null;
  authoritativeChatMode: StoredChatMode | null;
  authoritativeModel: ModelSelection | null;
}

export function acceptChatTurn(
  database: ChatTurnDatabase,
  input: AcceptChatTurnInput,
): AcceptedChatTurn {
  const selectedModel = input.selectedModel;
  if (input.chatTurnIntent) {
    ensureIntentRecord(input.chatTurnIntent);
  }
  if (
    input.chatTurnIntentId &&
    getAcceptedMessageId(input.chatTurnIntentId) !== undefined
  ) {
    return {
      userMessageId: null,
      authoritativeChatMode: null,
      authoritativeModel: null,
    };
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
      tx.update(chats)
        .set({ modelSelection: selectedModel })
        .where(and(eq(chats.id, input.chatId), isNull(chats.modelSelection)))
        .run();
      return {
        userMessageId: null,
        authoritativeChatMode: null,
        authoritativeModel: null,
      };
    }

    tx.update(chats)
      .set({ modelSelection: selectedModel })
      .where(and(eq(chats.id, input.chatId), isNull(chats.modelSelection)))
      .run();
    const authoritativeModel = tx
      .select({ modelSelection: chats.modelSelection })
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get()?.modelSelection;
    if (!authoritativeModel) {
      throw new DyadError(
        `Chat not found: ${input.chatId}`,
        DyadErrorKind.NotFound,
      );
    }

    if (input.storedChatMode !== null) {
      return {
        userMessageId: insertedUserMessage.id,
        authoritativeChatMode: null,
        authoritativeModel,
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
        authoritativeModel,
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
      authoritativeModel,
    };
  });
  if (accepted.userMessageId !== null && input.chatTurnIntentId) {
    markIntentAccepted(input.chatTurnIntentId, accepted.userMessageId);
  }
  return accepted;
}
