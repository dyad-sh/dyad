/**
 * Chat management tools for Dyad MCP Server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { DyadDatabase, Message } from "../database.js";
import { z } from "zod";

export function registerChatTools(
  db: DyadDatabase,
  registerTool: (tool: Tool, handler: (args: any) => Promise<any>) => void
): void {
  // ============================================
  // dyad_list_chats
  // ============================================
  registerTool(
    {
      name: "dyad_list_chats",
      description:
        "List all chats, optionally filtered by app ID. Chats represent conversations with the AI about building or modifying an app.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "Filter chats by app ID (optional)",
          },
        },
      },
    },
    async (args: { appId?: number }) => {
      const schema = z.object({
        appId: z.number().optional(),
      });
      const { appId } = schema.parse(args);

      const chats = await db.listChats(appId);

      return {
        chats,
        count: chats.length,
        filteredByApp: appId !== undefined,
        appId,
      };
    }
  );

  // ============================================
  // dyad_get_chat
  // ============================================
  registerTool(
    {
      name: "dyad_get_chat",
      description:
        "Get detailed information about a specific chat, including all messages in the conversation.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: {
            type: "number",
            description: "The unique ID of the chat",
          },
          includeMessages: {
            type: "boolean",
            description:
              "Whether to include all messages in the response (default: true)",
            default: true,
          },
        },
        required: ["chatId"],
      },
    },
    async (args: { chatId: number; includeMessages?: boolean }) => {
      const schema = z.object({
        chatId: z.number(),
        includeMessages: z.boolean().default(true),
      });
      const { chatId, includeMessages } = schema.parse(args);

      const chat = await db.getChat(chatId);
      if (!chat) {
        throw new Error(`Chat with ID ${chatId} not found`);
      }

      let messages: Message[] = [];
      if (includeMessages) {
        messages = await db.getChatMessages(chatId);
      }

      return {
        chat,
        messages,
        messageCount: messages.length,
      };
    }
  );

  // ============================================
  // dyad_search_chats
  // ============================================
  registerTool(
    {
      name: "dyad_search_chats",
      description:
        "Search for chats by title. Performs case-insensitive substring match.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to match against chat titles",
          },
          appId: {
            type: "number",
            description: "Filter results by app ID (optional)",
          },
        },
        required: ["query"],
      },
    },
    async (args: { query: string; appId?: number }) => {
      const schema = z.object({
        query: z.string(),
        appId: z.number().optional(),
      });
      const { query, appId } = schema.parse(args);

      const chats = await db.searchChats(query, appId);

      return {
        chats,
        count: chats.length,
        query,
        appId,
      };
    }
  );

  // ============================================
  // dyad_get_chat_messages
  // ============================================
  registerTool(
    {
      name: "dyad_get_chat_messages",
      description:
        "Get all messages from a specific chat. Messages are returned in chronological order and include both user prompts and AI responses.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: {
            type: "number",
            description: "The unique ID of the chat",
          },
          limit: {
            type: "number",
            description: "Maximum number of messages to return (optional)",
          },
        },
        required: ["chatId"],
      },
    },
    async (args: { chatId: number; limit?: number }) => {
      const schema = z.object({
        chatId: z.number(),
        limit: z.number().optional(),
      });
      const { chatId, limit } = schema.parse(args);

      let messages = await db.getChatMessages(chatId);

      if (limit && limit > 0) {
        messages = messages.slice(0, limit);
      }

      return {
        chatId,
        messages,
        count: messages.length,
        limited: limit !== undefined,
      };
    }
  );
}
