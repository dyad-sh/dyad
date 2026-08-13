import { z } from "zod";
import {
  ChatStreamParamsSchema,
  ChatResponseEndSchema,
} from "@/ipc/types/chat";
import { ChatStreamInvocationRefSchema } from "@/ipc/types/chat";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import {
  MAX_CHAT_ERROR_CHARS,
  MAX_CHAT_PROMPT_CHARS,
  MAX_CHAT_WIRE_ID_CHARS,
} from "@/shared/chatAttachmentLimits";

export const CHAT_STREAM_MACHINE_ID = "chat_stream" as const;
const MEBIBYTE = 1_024 * 1_024;

// A valid 25 MiB attachment set expands to roughly 34 MiB as base64. Keep the
// remote path bounded while preserving that existing chat contract.
export const CHAT_STREAM_MAX_DISPATCH_ENVELOPE_BYTES = 48 * MEBIBYTE;
export const CHAT_STREAM_MAX_QUEUE_BYTES = 48 * MEBIBYTE;
export const CHAT_STREAM_MAX_SNAPSHOT_ENVELOPE_BYTES = 64 * MEBIBYTE;

const chatKeys = new Map<number, Readonly<{ chatId: number }>>();

export function chatStreamKey(chatId: number): Readonly<{ chatId: number }> {
  let key = chatKeys.get(chatId);
  if (!key) {
    key = Object.freeze({ chatId });
    chatKeys.set(chatId, key);
  }
  return key;
}

export const ChatStreamKeySchema = z
  .object({ chatId: z.number().int().positive() })
  .strict()
  .transform((key) => Object.freeze(key));
export type ChatStreamKey = z.infer<typeof ChatStreamKeySchema>;

export const ChatTurnOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("user-input-follow-up"),
      requestId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan-handoff"),
      handoffId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
    })
    .strict(),
]);

export const SerializableChatTurnIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().min(1).max(256),
    appId: z.number().int().positive().optional(),
    originWindowSessionId: z
      .string()
      .min(1)
      .max(MAX_CHAT_WIRE_ID_CHARS)
      .optional(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    owner: ChatTurnOwnerSchema.optional(),
  })
  .and(ChatStreamParamsSchema)
  .superRefine((intent, context) => {
    if (
      intent.invocationRef &&
      intent.invocationRef.entityKey !== intent.chatId
    ) {
      context.addIssue({
        code: "custom",
        path: ["invocationRef", "entityKey"],
        message: "Invocation must belong to the routed chat",
      });
    }
  });
export type SerializableChatTurnIntent = z.infer<
  typeof SerializableChatTurnIntentSchema
>;

export const ChatQueueEntrySchema = z
  .object({
    itemId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
    intentId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
    prompt: z.string().max(MAX_CHAT_PROMPT_CHARS),
    attachments: ChatStreamParamsSchema.shape.attachments,
    selectedComponents: ChatStreamParamsSchema.shape.selectedComponents,
    redo: z.boolean().optional(),
    appId: z.number().int().positive().optional(),
    requestedChatMode: ChatStreamParamsSchema.shape.requestedChatMode,
    persistence: z.enum(["durable", "main-session"]),
    editable: z.boolean(),
    removable: z.boolean(),
  })
  .strict();
export type ChatQueueEntry = z.infer<typeof ChatQueueEntrySchema>;

const expectedQueueRevision = z.number().int().nonnegative();
const queueMutationId = z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS);

export const ChatStreamIntentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SUBMIT"),
      intent: SerializableChatTurnIntentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL"),
      invocationRef: ChatStreamInvocationRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("REPORT_ERROR"),
      error: z.string().min(1).max(MAX_CHAT_ERROR_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("PAUSE_QUEUE"),
      expectedQueueRevision,
      mutationId: queueMutationId,
    })
    .strict(),
  z
    .object({
      type: z.literal("RESUME_QUEUE"),
      expectedQueueRevision,
      mutationId: queueMutationId,
    })
    .strict(),
  z
    .object({
      type: z.literal("EDIT_QUEUE_ENTRY"),
      itemId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
      expectedQueueRevision,
      mutationId: queueMutationId,
      prompt: z.string().max(MAX_CHAT_PROMPT_CHARS),
      attachments: ChatStreamParamsSchema.shape.attachments,
      selectedComponents: ChatStreamParamsSchema.shape.selectedComponents,
    })
    .strict(),
  z
    .object({
      type: z.literal("REORDER_QUEUE_ENTRY"),
      itemId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
      toIndex: z.number().int().nonnegative(),
      expectedQueueRevision,
      mutationId: queueMutationId,
    })
    .strict(),
  z
    .object({
      type: z.literal("REMOVE_QUEUE_ENTRY"),
      itemId: z.string().min(1).max(MAX_CHAT_WIRE_ID_CHARS),
      expectedQueueRevision,
      mutationId: queueMutationId,
    })
    .strict(),
  z
    .object({
      type: z.literal("CLEAR_QUEUE"),
      expectedQueueRevision,
      mutationId: queueMutationId,
    })
    .strict(),
]);
export type ChatStreamIntentEvent = z.infer<typeof ChatStreamIntentEventSchema>;

export const ChatStreamHostEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ADMISSION_ACCEPTED"),
      intentId: z.string(),
      invocationRef: ChatStreamInvocationRefSchema,
      acceptedMessageId: z.number().int().positive().optional(),
      targetAppId: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ADMISSION_QUEUED"),
      intentId: z.string(),
      entry: ChatQueueEntrySchema,
      queueRevision: expectedQueueRevision,
    })
    .strict(),
  z
    .object({
      type: z.literal("ADMISSION_REPLAYED"),
      intentId: z.string(),
      acceptance: z.enum(["queued", "message-accepted", "rejected"]),
      acceptedMessageId: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ADMISSION_REJECTED"),
      intentId: z.string(),
      error: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("STREAM_ENDED"),
      intentId: z.string(),
      invocationRef: ChatStreamInvocationRefSchema,
      response: ChatResponseEndSchema,
      targetAppId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("STREAM_ERRORED"),
      intentId: z.string(),
      invocationRef: ChatStreamInvocationRefSchema,
      error: z.string(),
      warningMessages: z.array(z.string()).optional(),
      targetAppId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("QUEUE_MUTATED"),
      mutationId: queueMutationId.optional(),
      queueRevision: expectedQueueRevision,
      paused: z.boolean(),
      entries: z.array(ChatQueueEntrySchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("QUEUE_MUTATION_REJECTED"),
      mutationId: queueMutationId,
      error: z.string(),
      queueRevision: expectedQueueRevision,
      paused: z.boolean(),
      entries: z.array(ChatQueueEntrySchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("LIFECYCLE_COMMAND_FAILED"),
      command: z.enum(["cancel-active", "finalize"]),
      intentId: z.string(),
      invocationRef: ChatStreamInvocationRefSchema,
      error: z.string(),
      queueRevision: expectedQueueRevision,
      paused: z.boolean(),
      entries: z.array(ChatQueueEntrySchema),
    })
    .strict(),
]);
export type ChatStreamHostEvent = z.infer<typeof ChatStreamHostEventSchema>;
export type ChatStreamWireEvent = ChatStreamIntentEvent | ChatStreamHostEvent;

export const ChatStreamRemoteSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chatId: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    phase: z.enum([
      "idle",
      "admitting",
      "streaming",
      "cancelling",
      "finalizing",
      "errored",
    ]),
    invocationRef: ChatStreamInvocationRefSchema.nullable(),
    error: z.string().nullable(),
    queueRevision: expectedQueueRevision,
    queuePaused: z.boolean(),
    queue: z.array(ChatQueueEntrySchema),
    capabilities: z
      .object({
        canSubmit: z.boolean(),
        canCancel: z.boolean(),
        canPauseQueue: z.boolean(),
        canResumeQueue: z.boolean(),
      })
      .strict(),
    lastAcceptance: z
      .object({
        intentId: z.string(),
        acceptance: z.enum([
          "queued",
          "message-accepted",
          "replayed",
          "rejected",
        ]),
        acceptedMessageId: z.number().int().positive().optional(),
        error: z.string().optional(),
      })
      .strict()
      .nullable(),
    lastCompletion: z
      .object({
        intentId: z.string(),
        invocationRef: ChatStreamInvocationRefSchema,
        outcome: z.enum(["completed", "cancelled", "errored"]),
        chatSummary: z.string().optional(),
        pausePromptQueue: z.boolean().optional(),
        updatedFiles: z.boolean().optional(),
        extraFiles: z.array(z.string()).optional(),
        extraFilesError: z.string().optional(),
        warningMessages: z.array(z.string()).optional(),
        targetAppId: z.number().int().positive().nullable(),
        error: z.string().optional(),
      })
      .strict()
      .nullable(),
    lastQueueMutation: z
      .object({
        mutationId: queueMutationId,
        outcome: z.enum(["applied", "rejected"]),
        error: z.string().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ChatStreamRemoteSnapshot = z.infer<
  typeof ChatStreamRemoteSnapshotSchema
>;

export function unavailableChatStreamSnapshot(
  chatId: number,
): ChatStreamRemoteSnapshot {
  return {
    schemaVersion: 1,
    chatId,
    revision: 0,
    phase: "idle",
    invocationRef: null,
    error: null,
    queueRevision: 0,
    queuePaused: false,
    queue: [],
    capabilities: {
      canSubmit: true,
      canCancel: false,
      canPauseQueue: true,
      canResumeQueue: false,
    },
    lastAcceptance: null,
    lastCompletion: null,
    lastQueueMutation: null,
  };
}

export const chatStreamClientDefinition = {
  id: CHAT_STREAM_MACHINE_ID,
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: ChatStreamKeySchema,
    encodeKey: (key) => key,
    eventCodec: ChatStreamIntentEventSchema,
    snapshotCodec: ChatStreamRemoteSnapshotSchema,
    keyToString: (key) => String(key.chatId),
    unavailableSnapshot: (key) => unavailableChatStreamSnapshot(key.chatId),
  },
} satisfies RemoteClientDefinition<
  ChatStreamKey,
  ChatStreamRemoteSnapshot,
  ChatStreamIntentEvent,
  string
>;
