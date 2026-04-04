/**
 * MCP Tools — Chat Sessions
 *
 * Browse chat history and read messages from JoyCreate conversations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq, desc, like } from "drizzle-orm";

export function registerChatTools(server: McpServer) {
  // ── List chats ───────────────────────────────────────────────────
  server.registerTool(
    "joycreate_list_chats",
    {
      description:
        "List chat sessions in JoyCreate. Each chat belongs to an app (project). Returns recent chats by default.",
      inputSchema: {
        search: z.string().optional().describe("Search chats by title"),
        appId: z.number().optional().describe("Filter by app ID"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
    },
    async ({ search, appId, limit }) => {
      const db = getDb();
      let query = db
        .select({
          id: chats.id,
          appId: chats.appId,
          title: chats.title,
          createdAt: chats.createdAt,
        })
        .from(chats)
        .$dynamic();

      if (search) {
        query = query.where(like(chats.title, `%${search}%`));
      }
      if (appId != null) {
        query = query.where(eq(chats.appId, appId));
      }

      const rows = await query
        .orderBy(desc(chats.createdAt))
        .limit(limit ?? 20);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  // ── Get chat messages ────────────────────────────────────────────
  server.registerTool(
    "joycreate_get_chat_messages",
    {
      description:
        "Retrieve messages from a specific chat session. Returns user & assistant messages in order.",
      inputSchema: {
        chatId: z.number().describe("The chat session ID"),
        limit: z.number().optional().describe("Max messages to return (default 50)"),
      },
    },
    async ({ chatId, limit }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          model: messages.model,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt)
        .limit(limit ?? 50);

      if (rows.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No messages found for chat ${chatId}.` },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
