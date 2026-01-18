/**
 * Chat Handlers - Refactored with type-safe IPC pattern
 *
 * This module demonstrates the new modular, type-safe approach to IPC handlers.
 */

import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import type { ChatSearchResult, ChatSummary } from "../../lib/schemas";
import { createHandlerFactory } from "../ipc_handler";
import log from "electron-log";
import { getDyadAppPath } from "../../paths/paths";
import { getCurrentCommitHash } from "../utils/git_utils";

const logger = log.scope("chat_handlers");
const handle = createHandlerFactory({ logger, logDetails: false });

export function registerChatHandlers() {
  // Create a new chat for an app
  handle("create-chat", async (_, appId) => {
    // Get the app's path first
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
      columns: {
        path: true,
      },
    });

    if (!app) {
      throw new Error("App not found");
    }

    let initialCommitHash = null;
    try {
      // Get the current git revision of main branch
      initialCommitHash = await getCurrentCommitHash({
        path: getDyadAppPath(app.path),
        ref: "main",
      });
    } catch (error) {
      logger.error("Error getting git revision:", error);
      // Continue without the git revision
    }

    // Create a new chat
    const [chat] = await db
      .insert(chats)
      .values({
        appId,
        initialCommitHash,
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

  // Get a single chat with all its messages
  handle("get-chat", async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
      },
    });

    if (!chat) {
      throw new Error("Chat not found");
    }

    return chat;
  });

  // List chats, optionally filtered by app
  handle("get-chats", async (_, appId) => {
    // If appId is provided, filter chats for that app
    const query = appId
      ? db.query.chats.findMany({
          where: eq(chats.appId, appId),
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
          },
          orderBy: [desc(chats.createdAt)],
        })
      : db.query.chats.findMany({
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
          },
          orderBy: [desc(chats.createdAt)],
        });

    const allChats = await query;
    return allChats;
  });

  // Delete a chat
  handle("delete-chat", async (_, chatId) => {
    await db.delete(chats).where(eq(chats.id, chatId));
  });

  // Update chat properties
  handle("update-chat", async (_, { chatId, title }) => {
    await db.update(chats).set({ title }).where(eq(chats.id, chatId));
  });

  // Delete all messages in a chat
  handle("delete-messages", async (_, chatId) => {
    await db.delete(messages).where(eq(messages.chatId, chatId));
  });
}
