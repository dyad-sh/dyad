import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, or } from "drizzle-orm";

import * as schema from "@/db/schema";
import { chats, messages } from "@/db/schema";
import {
  ensureIntentRecord,
  getAcceptedMessageId,
  markIntentAccepted,
  persistAcceptedChatTurn,
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
      chatTurnIntentId: input.chatTurnIntentId,
    });
    const insertedUserMessage = insert
      .onConflictDoNothing()
      .returning({ id: messages.id })
      .get();

    const acceptedMessageId =
      insertedUserMessage?.id ??
      (input.chatTurnIntentId || input.userInputRequestId
        ? tx
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.chatId, input.chatId),
                or(
                  ...(input.chatTurnIntentId
                    ? [eq(messages.chatTurnIntentId, input.chatTurnIntentId)]
                    : []),
                  ...(input.userInputRequestId
                    ? [
                        eq(
                          messages.userInputRequestId,
                          input.userInputRequestId,
                        ),
                      ]
                    : []),
                ),
              ),
            )
            .get()?.id
        : undefined);
    if (acceptedMessageId === undefined) {
      throw new DyadError(
        `Chat turn acceptance could not resolve its user message for chat ${input.chatId}`,
        DyadErrorKind.Internal,
      );
    }
    persistAcceptedChatTurn(
      tx,
      input.chatTurnIntent,
      input.chatTurnIntentId,
      acceptedMessageId,
    );

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
        acceptedMessageId,
        authoritativeChatMode: null,
        authoritativeModel: null,
      };
    }

    tx.update(chats)
      .set({ modelSelection: selectedModel })
      .where(and(eq(chats.id, input.chatId), isNull(chats.modelSelection)))
      .run();
    tx.update(chats)
      .set({ chatMode: input.selectedChatMode })
      .where(and(eq(chats.id, input.chatId), isNull(chats.chatMode)))
      .run();

    const winningChat = tx
      .select({
        chatMode: chats.chatMode,
        modelSelection: chats.modelSelection,
      })
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get();
    if (!winningChat) {
      throw new DyadError(
        `Chat not found: ${input.chatId}`,
        DyadErrorKind.NotFound,
      );
    }
    if (!winningChat.chatMode || !winningChat.modelSelection) {
      throw new DyadError(
        `Chat turn acceptance failed to latch mode and model selection for chat ${input.chatId}`,
        DyadErrorKind.Internal,
      );
    }
    return {
      userMessageId: insertedUserMessage.id,
      acceptedMessageId,
      authoritativeChatMode: winningChat.chatMode,
      authoritativeModel: winningChat.modelSelection,
    };
  });
  if (input.chatTurnIntentId) {
    markIntentAccepted(input.chatTurnIntentId, accepted.acceptedMessageId);
  }
  return accepted;
}
