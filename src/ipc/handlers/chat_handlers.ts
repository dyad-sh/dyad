import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import type { ChatSearchResult, ChatSummary } from "../../lib/schemas";

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "../../paths/paths";
import { getCurrentCommitHash } from "../utils/git_utils";
import { withLock } from "../utils/lock_utils";
import { createTypedHandler } from "./base";
import { chatContracts } from "../types/chat";
import { normalizeStoredChatMode } from "./chat_mode_resolution";
import { cancelActiveStreamsForChat } from "./chat_stream_handlers";
import {
  rendererMessageColumns,
  toRendererMessage,
} from "../utils/renderer_chat_message";
import { createChatForApp } from "../utils/chat_creation_utils";

const logger = log.scope("chat_handlers");

export function registerChatHandlers() {
  createTypedHandler(chatContracts.createChat, async (_, input) => {
    const { appId, initialChatMode } =
      typeof input === "number"
        ? { appId: input, initialChatMode: undefined }
        : input;

    return createChatForApp({ appId, initialChatMode });
  });

  createTypedHandler(chatContracts.getChat, async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: {
        id: true,
        appId: true,
        title: true,
        initialCommitHash: true,
        chatMode: true,
      },
      with: {
        messages: {
          columns: rendererMessageColumns,
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
      },
    });

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title ?? "",
      initialCommitHash: chat.initialCommitHash,
      chatMode: normalizeStoredChatMode(chat.chatMode),
      messages: chat.messages.map(toRendererMessage),
    };
  });

  createTypedHandler(chatContracts.getChatMetadata, async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: {
        id: true,
        appId: true,
        title: true,
        createdAt: true,
        chatMode: true,
        isFavorite: true,
      },
    });

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title,
      createdAt: chat.createdAt,
      chatMode: normalizeStoredChatMode(chat.chatMode),
      isFavorite: chat.isFavorite,
    };
  });

  createTypedHandler(chatContracts.getChats, async (_, appId) => {
    // If appId is provided, filter chats for that app
    const query = appId
      ? db.query.chats.findMany({
          where: eq(chats.appId, appId),
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
            chatMode: true,
            isFavorite: true,
          },
          orderBy: [desc(chats.createdAt)],
        })
      : db.query.chats.findMany({
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
            chatMode: true,
            isFavorite: true,
          },
          orderBy: [desc(chats.createdAt)],
        });

    const allChats = await query;
    return allChats.map((chat) => ({
      ...chat,
      chatMode: normalizeStoredChatMode(chat.chatMode),
    })) satisfies ChatSummary[];
  });

  createTypedHandler(chatContracts.deleteChat, async (event, chatId) => {
    const chat = await db.query.chats.findFirst({
      columns: { appId: true },
      where: eq(chats.id, chatId),
    });
    if (!chat) {
      return;
    }
    // Cancel any in-flight stream for this chat BEFORE taking the app lock and
    // deleting rows, otherwise a still-running generation could re-insert
    // messages after the delete and resurrect the chat. Cancellation must run
    // outside the lock because the aborted stream may take the same app lock for
    // its own writes (e.g. copy_file).
    await cancelActiveStreamsForChat(chatId, event.sender);
    await withLock(chat.appId, async () => {
      await db.delete(chats).where(eq(chats.id, chatId));
    });
  });

  createTypedHandler(chatContracts.updateChat, async (_, params) => {
    const { chatId, title, chatMode } = params;
    const updates: Partial<typeof chats.$inferInsert> = {};
    if (title !== undefined) {
      updates.title = title;
    }
    if (chatMode !== undefined) {
      updates.chatMode = chatMode;
    }
    if (Object.keys(updates).length === 0) {
      return;
    }
    await db.update(chats).set(updates).where(eq(chats.id, chatId));
  });

  createTypedHandler(chatContracts.setChatFavorite, async (_, params) => {
    const updated = await db
      .update(chats)
      .set({ isFavorite: params.isFavorite })
      .where(eq(chats.id, params.chatId))
      .returning({ isFavorite: chats.isFavorite });

    if (updated.length === 0) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return updated[0];
  });

  createTypedHandler(chatContracts.deleteMessages, async (event, chatId) => {
    const chat = await db.query.chats.findFirst({
      columns: { appId: true },
      where: eq(chats.id, chatId),
    });
    if (!chat) {
      return;
    }
    // Cancel any in-flight stream for this chat BEFORE taking the app lock and
    // clearing messages, otherwise a still-running generation could insert new
    // messages after the delete and leave the chat non-empty. Cancellation must
    // run outside the lock because the aborted stream may take the same app lock
    // for its own writes (e.g. copy_file).
    await cancelActiveStreamsForChat(chatId, event.sender);
    await withLock(chat.appId, async () => {
      await db.delete(messages).where(eq(messages.chatId, chatId));
    });
  });

  createTypedHandler(chatContracts.searchChats, async (_, params) => {
    const { appId, query } = params;
    // 1) Find chats by title and map to ChatSearchResult with no matched message
    const chatTitleMatches = await db
      .select({
        id: chats.id,
        appId: chats.appId,
        title: chats.title,
        createdAt: chats.createdAt,
      })
      .from(chats)
      .where(and(eq(chats.appId, appId), like(chats.title, `%${query}%`)))
      .orderBy(desc(chats.createdAt))
      .limit(10);

    const titleResults: ChatSearchResult[] = chatTitleMatches.map((c) => ({
      id: c.id,
      appId: c.appId,
      title: c.title,
      createdAt: c.createdAt,
      matchedMessageContent: null,
    }));

    // 2) Find messages that match and join to chats to build one result per message
    const messageResults = await db
      .select({
        id: chats.id,
        appId: chats.appId,
        title: chats.title,
        createdAt: chats.createdAt,
        matchedMessageContent: messages.content,
      })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(eq(chats.appId, appId), like(messages.content, `%${query}%`)))
      .orderBy(desc(chats.createdAt))
      .limit(10);

    // Combine: keep title matches and per-message matches
    const combined: ChatSearchResult[] = [...titleResults, ...messageResults];
    const uniqueChats = Array.from(
      new Map(combined.map((item) => [item.id, item])).values(),
    );

    // Sort newest chats first
    uniqueChats.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return uniqueChats;
  });

  logger.debug("Registered chat IPC handlers");
}
