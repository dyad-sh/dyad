import { z } from "zod";
import {
  defineContract,
  defineStream,
  createClient,
  createStreamClient,
} from "../contracts/core";

// =============================================================================
// Chat Schemas
// =============================================================================

/**
 * Schema for a Message object.
 */
export const MessageSchema = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  approvalState: z.enum(["approved", "rejected"]).nullable().optional(),
  commitHash: z.string().nullable().optional(),
  sourceCommitHash: z.string().nullable().optional(),
  dbTimestamp: z.string().nullable().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  requestId: z.string().nullable().optional(),
  totalTokens: z.number().nullable().optional(),
  model: z.string().nullable().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

/**
 * Schema for a Chat object.
 */
export const ChatSchema = z.object({
  id: z.number(),
  title: z.string(),
  messages: z.array(MessageSchema),
  initialCommitHash: z.string().nullable().optional(),
  dbTimestamp: z.string().nullable().optional(),
});

export type Chat = z.infer<typeof ChatSchema>;

/**
 * Schema for component selection (used in chat context).
 */
export const ComponentSelectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  runtimeId: z.string().optional(),
  relativePath: z.string(),
  lineNumber: z.number(),
  columnNumber: z.number(),
});

export type ComponentSelection = z.infer<typeof ComponentSelectionSchema>;

/**
 * Schema for file attachment in chat (base64 encoded for IPC transfer).
 */
export const ChatAttachmentSchema = z.object({
  name: z.string(),
  type: z.string(),
  data: z.string(), // Base64 encoded
  attachmentType: z.enum(["upload-to-codebase", "chat-context"]),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/**
 * FileAttachment type for browser File objects (before base64 conversion).
 * Used by components that handle file uploads.
 */
export interface FileAttachment {
  file: File;
  type: "upload-to-codebase" | "chat-context";
}

/**
 * Schema for chat stream parameters.
 */
export const ChatStreamParamsSchema = z.object({
  chatId: z.number(),
  prompt: z.string(),
  redo: z.boolean().optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
  selectedComponents: z.array(ComponentSelectionSchema).optional(),
});

export type ChatStreamParams = z.infer<typeof ChatStreamParamsSchema>;

/**
 * Schema for chat response chunk event.
 */
export const ChatResponseChunkSchema = z.object({
  chatId: z.number(),
  messages: z.array(MessageSchema),
});

/**
 * Schema for chat response end event.
 */
export const ChatResponseEndSchema = z.object({
  chatId: z.number(),
  updatedFiles: z.boolean(),
  extraFiles: z.array(z.string()).optional(),
  extraFilesError: z.string().optional(),
  totalTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  chatSummary: z.string().optional(),
});

export type ChatResponseEnd = z.infer<typeof ChatResponseEndSchema>;

/**
 * Schema for chat response error event.
 */
export const ChatResponseErrorSchema = z.object({
  chatId: z.number(),
  error: z.string(),
});

/**
 * Schema for create chat result (returns chatId).
 */
export const CreateChatResultSchema = z.number();

/**
 * Schema for update chat params.
 */
export const UpdateChatParamsSchema = z.object({
  chatId: z.number(),
  title: z.string(),
});

export type UpdateChatParams = z.infer<typeof UpdateChatParamsSchema>;

/**
 * Schema for token count params.
 */
export const TokenCountParamsSchema = z.object({
  chatId: z.number(),
  input: z.string(),
});

export type TokenCountParams = z.infer<typeof TokenCountParamsSchema>;

/**
 * Schema for token count result.
 */
export const TokenCountResultSchema = z.object({
  estimatedTotalTokens: z.number(),
  actualMaxTokens: z.number().nullable(),
  messageHistoryTokens: z.number(),
  codebaseTokens: z.number(),
  mentionedAppsTokens: z.number(),
  inputTokens: z.number(),
  systemPromptTokens: z.number(),
  contextWindow: z.number(),
});

export type TokenCountResult = z.infer<typeof TokenCountResultSchema>;

// =============================================================================
// Chat Contracts (Invoke/Response)
// =============================================================================

export const chatContracts = {
  getChat: defineContract({
    channel: "get-chat",
    input: z.number(), // chatId
    output: ChatSchema,
  }),

  getChats: defineContract({
    channel: "get-chats",
    input: z.number().optional(), // appId (optional)
    output: z.array(
      z.object({
        id: z.number(),
        appId: z.number(),
        title: z.string().nullable(),
        createdAt: z.date(),
      }),
    ),
  }),

  createChat: defineContract({
    channel: "create-chat",
    input: z.number(), // appId
    output: CreateChatResultSchema,
  }),

  updateChat: defineContract({
    channel: "update-chat",
    input: UpdateChatParamsSchema,
    output: z.void(),
  }),

  deleteChat: defineContract({
    channel: "delete-chat",
    input: z.number(), // chatId
    output: z.void(),
  }),

  deleteMessages: defineContract({
    channel: "delete-messages",
    input: z.number(), // chatId
    output: z.void(),
  }),

  searchChats: defineContract({
    channel: "search-chats",
    input: z.object({
      appId: z.number(),
      query: z.string(),
    }),
    output: z.array(
      z.object({
        id: z.number(),
        appId: z.number(),
        title: z.string().nullable(),
        createdAt: z.date(),
        matchedMessageContent: z.string().nullable(),
      }),
    ),
  }),

  countTokens: defineContract({
    channel: "chat:count-tokens",
    input: TokenCountParamsSchema,
    output: TokenCountResultSchema,
  }),

  cancelStream: defineContract({
    channel: "chat:cancel",
    input: z.number(), // chatId
    output: z.boolean(),
  }),
} as const;

// =============================================================================
// Chat Stream Contract
// =============================================================================

/**
 * Chat stream contract for streaming responses.
 * Uses chatId as the key field to route events to the correct callbacks.
 */
export const chatStreamContract = defineStream({
  channel: "chat:stream",
  input: ChatStreamParamsSchema,
  keyField: "chatId",
  events: {
    chunk: {
      channel: "chat:response:chunk",
      payload: ChatResponseChunkSchema,
    },
    end: {
      channel: "chat:response:end",
      payload: ChatResponseEndSchema,
    },
    error: {
      channel: "chat:response:error",
      payload: ChatResponseErrorSchema,
    },
  },
});

// =============================================================================
// Chat Clients
// =============================================================================

/**
 * Type-safe client for chat IPC operations.
 * Auto-generated from contracts.
 *
 * @example
 * const chat = await chatClient.getChat(chatId);
 * const chatId = await chatClient.createChat(appId);
 */
export const chatClient = createClient(chatContracts);

/**
 * Type-safe client for chat streaming.
 * Manages callbacks internally and routes events by chatId.
 *
 * @example
 * chatStreamClient.start(
 *   { chatId: 123, prompt: "Hello" },
 *   {
 *     onChunk: (data) => setMessages(data.messages),
 *     onEnd: (data) => console.log("Done", data.updatedFiles),
 *     onError: (data) => showError(data.error),
 *   }
 * );
 */
export const chatStreamClient = createStreamClient(chatStreamContract);
