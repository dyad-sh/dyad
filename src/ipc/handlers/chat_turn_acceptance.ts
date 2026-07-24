import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, inArray, isNull } from "drizzle-orm";

import * as schema from "@/db/schema";
import { chats, messages, userInputFollowUpHandoffs } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { ChatMode, StoredChatMode } from "@/lib/schemas";

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
    if (input.userInputRequestId) {
      const handoff = tx
        .select({
          chatId: userInputFollowUpHandoffs.chatId,
          prompt: userInputFollowUpHandoffs.prompt,
          status: userInputFollowUpHandoffs.status,
        })
        .from(userInputFollowUpHandoffs)
        .where(
          eq(userInputFollowUpHandoffs.requestId, input.userInputRequestId),
        )
        .get();
      if (handoff?.status === "rejected") {
        throw new DyadError(
          `User-input handoff was rejected: ${input.userInputRequestId}`,
          DyadErrorKind.UserCancelled,
        );
      }
      if (
        handoff &&
        (handoff.chatId !== input.chatId || handoff.prompt !== input.content)
      ) {
        throw new DyadError(
          `User-input handoff payload mismatch: ${input.userInputRequestId}`,
          DyadErrorKind.Conflict,
        );
      }
    }

    const acknowledgeUserInputHandoff = () => {
      if (!input.userInputRequestId) return;
      const timestamp = new Date();
      tx.update(userInputFollowUpHandoffs)
        .set({
          status: "acknowledged",
          updatedAt: timestamp,
          settledAt: timestamp,
          lastError: null,
        })
        .where(
          and(
            eq(userInputFollowUpHandoffs.requestId, input.userInputRequestId),
            inArray(userInputFollowUpHandoffs.status, [
              "accepted",
              "executing",
            ]),
          ),
        )
        .run();
    };

    const insertedUserMessage = tx
      .insert(messages)
      .values({
        chatId: input.chatId,
        role: "user",
        content: input.content,
        userInputRequestId: input.userInputRequestId,
      })
      .onConflictDoNothing({
        target: [messages.chatId, messages.userInputRequestId],
      })
      .returning({ id: messages.id })
      .get();

    if (!insertedUserMessage) {
      // Repair chats accepted before first-turn latching became atomic.
      tx.update(chats)
        .set({ chatMode: input.selectedChatMode })
        .where(and(eq(chats.id, input.chatId), isNull(chats.chatMode)))
        .run();
      acknowledgeUserInputHandoff();
      return { userMessageId: null, authoritativeChatMode: null };
    }

    acknowledgeUserInputHandoff();

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
}
