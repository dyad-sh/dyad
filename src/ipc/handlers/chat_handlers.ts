import { ipcMain } from "electron";
import { db } from "../../db";
import { chats } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import type { ChatSummary } from "../../lib/schemas";

export function registerChatHandlers() {
  ipcMain.handle("create-chat", async (_, appId: number) => {
    // Create a new chat
    const [chat] = await db
      .insert(chats)
      .values({
        appId,
      })
      .returning();

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
      console.error("Error deleting chat:", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
