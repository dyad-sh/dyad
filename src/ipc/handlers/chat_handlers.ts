import { ipcMain } from "electron";
import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import type { ChatSummary } from "../../lib/schemas";
import * as git from "isomorphic-git";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getDyadAppPath } from "../../paths/paths";

const logger = log.scope("chat_handlers");

export function registerChatHandlers() {
  ipcMain.handle("create-chat", async (_, appId: number) => {
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
      initialCommitHash = await git.resolveRef({
        fs,
        dir: getDyadAppPath(app.path),
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
      initialCommitHash
    );
    return chat.id;
  });

  ipcMain.handle("get-chat", async (_, chatId: number) => {
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

  ipcMain.handle(
    "get-chats",
    async (_, appId?: number): Promise<ChatSummary[]> => {
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
    }
  );

  ipcMain.handle("delete-chat", async (_, chatId: number) => {
    try {
      // Delete the chat and its associated messages
      await db.delete(chats).where(eq(chats.id, chatId));
      return { success: true };
    } catch (error) {
      logger.error("Error deleting chat:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("delete-messages", async (_, chatId: number) => {
    try {
      await db.delete(messages).where(eq(messages.chatId, chatId));
      return { success: true };
    } catch (error) {
      logger.error("Error deleting messages:", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
