import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import type { ChatSearchResult, ChatSummary } from "../../lib/schemas";

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "../../paths/paths";
import { getCurrentCommitHash } from "../utils/git_utils";
import { createTypedHandler } from "./base";
import { chatContracts } from "../types/chat";

const logger = log.scope("chat_handlers");

export function registerChatHandlers() {
  createTypedHandler(chatContracts.createChat, async (_, appId) => {
    // The chat stores null for chatMode initially, and the UI falls back
    // to the global/default mode behavior via useInitialChatMode().

    // Get the app's path first
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
      columns: {
        path: true,
      },
    });

    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    let initialCommitHash = null;
    try {
      // Get the current git revision of the currently checked-out branch
      initialCommitHash = await getCurrentCommitHash({
        path: getDyadAppPath(app.path),
      });
    } catch (error) {
      logger.error("Error getting git revision:", error);
      // Continue without the git revision
    }

    // Create a new chat with null chatMode (will be set by UI on first message)
    const [chat] = await db
      .insert(chats)
      .values({
        appId,
        initialCommitHash,
        chatMode: null,
      })
      .returning();
    logger.info(
      "Created chat:",
      chat.id,
      "for app:",
      appId,
      "with initial commit hash:",
      initialCommitHash,
    );
    return chat.id;
  });

  createTypedHandler(chatContracts.getChat, async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
      },
    });

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      ...chat,
      title: chat.title ?? "",
      messages: chat.messages.map((m) => ({
        ...m,
        role: m.role as "user" | "assistant",
      })),
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
          },
          orderBy: [desc(chats.createdAt)],
        });

    const allChats = await query;
    return allChats as ChatSummary[];
  });

  createTypedHandler(chatContracts.deleteChat, async (_, chatId) => {
    await db.delete(chats).where(eq(chats.id, chatId));
  });

  createTypedHandler(chatContracts.updateChat, async (_, params) => {
    const { chatId, title } = params;
    await db.update(chats).set({ title }).where(eq(chats.id, chatId));
  });

  createTypedHandler(chatContracts.updateChatMode, async (_, params) => {
    const { chatId, appId, chatMode } = params;
    const result = await db
      .update(chats)
      .set({ chatMode })
      .where(and(eq(chats.id, chatId), eq(chats.appId, appId)));

    if (result.changes === 0) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    logger.info(
      "Updated chat mode for chat:",
      chatId,
      "in app:",
      appId,
      "to:",
      chatMode,
    );
  });

  createTypedHandler(chatContracts.deleteMessages, async (_, chatId) => {
    await db.delete(messages).where(eq(messages.chatId, chatId));
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
        chatMode: chats.chatMode,
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
      chatMode: c.chatMode,
    }));

    // 2) Find messages that match and join to chats to build one result per message
    const messageResults = await db
      .select({
        id: chats.id,
        appId: chats.appId,
        title: chats.title,
        createdAt: chats.createdAt,
        matchedMessageContent: messages.content,
        chatMode: chats.chatMode,
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
