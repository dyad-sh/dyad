import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { chats } from "@/db/schema";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  cancelActiveStreamsForChat,
  executeChatStreamFromActor,
} from "@/ipc/handlers/chat_stream_handlers";
import {
  chatExecutionEndpoint,
  publishChatInvalidations,
} from "@/ipc/services/chat_actor_platform";
import type { ChatStreamHostCommand, ChatStreamHostState } from "./host_state";
import {
  initialChatStreamHostState,
  transitionChatStreamHost,
  type ChatStreamHostIgnoreReason,
} from "./host_transition";
import {
  loadChatQueue,
  completeSessionQueueAcceptance,
  disposeSessionChatQueue,
  hydrateChatStreamPersistence,
  isSessionQueuedIntent,
  markIntentTerminal,
  mutateChatQueue,
  peekQueueHead,
  persistQueuedIntent,
  persistSessionQueuedIntent,
  stageActiveIntent,
} from "./persistence";
import {
  CHAT_STREAM_MACHINE_ID,
  ChatStreamIntentEventSchema,
  ChatStreamKeySchema,
  ChatStreamRemoteSnapshotSchema,
  chatStreamKey,
  type ChatStreamKey,
  type ChatStreamRemoteSnapshot,
  type ChatStreamWireEvent,
  unavailableChatStreamSnapshot,
} from "./transport";

async function requireExistingChat(chatId: number): Promise<number> {
  const chat = db
    .select({ id: chats.id, appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) {
    throw new DyadError(`Chat not found: ${chatId}`, DyadErrorKind.Auth);
  }
  return chat.appId;
}

function projectSnapshot(
  state: ChatStreamHostState,
  chatId: number,
  revision: number,
): ChatStreamRemoteSnapshot {
  return {
    schemaVersion: 1,
    chatId,
    revision,
    phase: state.phase,
    invocationRef: state.active?.invocationRef ?? null,
    error: state.error,
    queueRevision: state.queueRevision,
    queuePaused: state.queuePaused,
    queue: [...state.queue],
    capabilities: {
      canSubmit: true,
      canCancel: state.phase === "admitting" || state.phase === "streaming",
      canPauseQueue: !state.queuePaused,
      canResumeQueue: state.queuePaused,
    },
    lastAcceptance: state.lastAcceptance,
    lastCompletion: state.lastCompletion,
    lastQueueMutation: state.lastQueueMutation,
  };
}

function createCommandRunner(
  context: Parameters<
    NonNullable<
      DistributedMachineDefinition<
        typeof CHAT_STREAM_MACHINE_ID,
        ChatStreamKey,
        ChatStreamHostState,
        ChatStreamWireEvent,
        ChatStreamHostCommand,
        ChatStreamHostIgnoreReason
      >["createCommandRunner"]
    >
  >[0],
) {
  const emit = context.send;
  const loadAuthoritativeQueue = () => {
    try {
      return loadChatQueue(db, context.key.chatId);
    } catch (error) {
      console.error(
        "[chat-stream] Failed to reload authoritative queue",
        error,
      );
      const snapshot = context.getSnapshot();
      return {
        queueRevision: snapshot.queueRevision,
        queuePaused: snapshot.queuePaused,
        queue: [...snapshot.queue],
      };
    }
  };
  return async (command: ChatStreamHostCommand): Promise<void> => {
    switch (command.type) {
      case "persist-queued": {
        try {
          const result =
            command.intent.owner?.kind === "user-input-follow-up"
              ? persistSessionQueuedIntent(db, command.intent)
              : persistQueuedIntent(db, command.intent);
          if (result.kind === "replayed") {
            emit({
              type: "ADMISSION_REPLAYED",
              intentId: command.intent.intentId,
              acceptance: result.acceptance,
              acceptedMessageId: result.acceptedMessageId,
            });
          } else {
            emit({
              type: "ADMISSION_QUEUED",
              intentId: command.intent.intentId,
              entry: result.entry,
              queueRevision: result.queueRevision,
            });
          }
        } catch (error) {
          emit({
            type: "ADMISSION_REJECTED",
            intentId: command.intent.intentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case "admit-and-start": {
        try {
          const replay = stageActiveIntent(db, command.intent);
          if (replay?.kind === "replayed") {
            emit({
              type: "ADMISSION_REPLAYED",
              intentId: command.intent.intentId,
              acceptance: replay.acceptance,
              acceptedMessageId: replay.acceptedMessageId,
            });
            if (replay.acceptance !== "queued") return;
          }
          const invocationRef = command.intent.invocationRef;
          if (!invocationRef) {
            throw new DyadError(
              "Chat submission is missing an invocation identity",
              DyadErrorKind.Validation,
            );
          }
          const endpoint = chatExecutionEndpoint(
            context.key.chatId,
            command.intent.originWindowSessionId,
          );
          const targetAppId =
            command.intent.appId ??
            (await requireExistingChat(context.key.chatId));
          void executeChatStreamFromActor(
            endpoint,
            {
              chatId: command.intent.chatId,
              intentId: command.intent.intentId,
              invocationRef,
              prompt: command.intent.prompt,
              redo: command.intent.redo,
              attachments: command.intent.attachments,
              selectedComponents: command.intent.selectedComponents,
              requestedChatMode: command.intent.requestedChatMode,
              userInputRequestId:
                command.intent.owner?.kind === "user-input-follow-up"
                  ? command.intent.owner.requestId
                  : command.intent.userInputRequestId,
            },
            {
              intent: command.intent,
              sessionQueued: isSessionQueuedIntent(command.intent.intentId),
              onAccepted: (acceptedMessageId) => {
                completeSessionQueueAcceptance(command.intent.intentId);
                emit({
                  type: "ADMISSION_ACCEPTED",
                  intentId: command.intent.intentId,
                  invocationRef,
                  acceptedMessageId,
                  targetAppId,
                });
                const queue = loadChatQueue(db, context.key.chatId);
                emit({
                  type: "QUEUE_MUTATED",
                  queueRevision: queue.queueRevision,
                  paused: queue.queuePaused,
                  entries: queue.queue,
                });
              },
              onEnd: (response) =>
                emit({
                  type: "STREAM_ENDED",
                  intentId: command.intent.intentId,
                  invocationRef,
                  response,
                  targetAppId,
                }),
              onError: ({ error, warningMessages }) =>
                emit({
                  type: "STREAM_ERRORED",
                  intentId: command.intent.intentId,
                  invocationRef,
                  error: error ?? "Chat stream failed",
                  warningMessages,
                  targetAppId,
                }),
            },
          ).catch((error) =>
            emit({
              type: "STREAM_ERRORED",
              intentId: command.intent.intentId,
              invocationRef,
              error: error instanceof Error ? error.message : String(error),
              targetAppId,
            }),
          );
        } catch (error) {
          emit({
            type: "ADMISSION_REJECTED",
            intentId: command.intent.intentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case "cancel-active": {
        try {
          const endpoint = chatExecutionEndpoint(context.key.chatId);
          await cancelActiveStreamsForChat(context.key.chatId, endpoint);
        } catch (error) {
          const active = context.getSnapshot().active;
          if (!active) return;
          const queue = loadAuthoritativeQueue();
          emit({
            type: "LIFECYCLE_COMMAND_FAILED",
            command: "cancel-active",
            intentId: active.intent.intentId,
            invocationRef: command.invocationRef,
            error: error instanceof Error ? error.message : String(error),
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
          });
        }
        return;
      }
      case "mutate-queue": {
        try {
          const queue = await mutateChatQueue(db, context.key.chatId, command);
          emit({
            type: "QUEUE_MUTATED",
            mutationId: command.mutationId,
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
          });
        } catch (error) {
          console.error("[chat-stream] Queue mutation failed", error);
          const queue = loadAuthoritativeQueue();
          emit({
            type: "QUEUE_MUTATION_REJECTED",
            mutationId: command.mutationId,
            error: error instanceof Error ? error.message : String(error),
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
          });
        }
        return;
      }
      case "finalize": {
        const active = context.getSnapshot().active;
        if (!active || active.intent.intentId !== command.intentId) {
          throw new Error("Finalization does not match the active chat intent");
        }
        try {
          const queue = markIntentTerminal(
            db,
            active.intent,
            command.response?.pausePromptQueue === true,
          );
          publishChatInvalidations(context.key.chatId);
          emit({
            type: "QUEUE_MUTATED",
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
          });
        } catch (error) {
          const queue = loadAuthoritativeQueue();
          emit({
            type: "LIFECYCLE_COMMAND_FAILED",
            command: "finalize",
            intentId: active.intent.intentId,
            invocationRef: active.invocationRef,
            error: error instanceof Error ? error.message : String(error),
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
          });
        }
        return;
      }
      case "dispatch-next": {
        const intent = peekQueueHead(db, context.key.chatId);
        if (intent) emit({ type: "SUBMIT", intent });
        return;
      }
    }
  };
}

export const chatStreamDefinition = {
  id: CHAT_STREAM_MACHINE_ID,
  host: "main",
  initialState: (key) =>
    initialChatStreamHostState(hydrateChatStreamPersistence(db, key.chatId)),
  transition: (state, event) => transitionChatStreamHost(state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) {
        void execute(command).catch((error) => {
          console.error("[chat-stream] Host command failed", {
            command: command.type,
            error,
          });
        });
      }
    },
  }),
  createCommandRunner,
  lifecycle: {
    subscriptionCreates: true,
    dispatchCreates: false,
    idleEviction: { kind: "retain" },
    terminalRetention: { kind: "retain" },
    entityDeletion: "dispose",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "persistent",
    flushOnShutdown: true,
    onDisposed: ({ key }) => {
      disposeSessionChatQueue(key.chatId);
    },
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: ChatStreamKeySchema,
    encodeKey: (key) => key,
    canonicalizeKeyAfterAuthorization: (key) => chatStreamKey(key.chatId),
    eventCodec: ChatStreamIntentEventSchema as z.ZodType<ChatStreamWireEvent>,
    snapshotCodec: ChatStreamRemoteSnapshotSchema,
    keyToString: (key) => String(key.chatId),
    projectSnapshot: (state, key, metadata) =>
      projectSnapshot(state, key.chatId, metadata.snapshotRevision),
    unavailableSnapshot: (key) => unavailableChatStreamSnapshot(key.chatId),
    revisionPolicy: (event) =>
      event.type === "SUBMIT" || event.type === "CANCEL"
        ? "allow-stale"
        : "reject-stale",
    authorizeSubscribe: async ({ key }) => {
      await requireExistingChat(key.chatId);
    },
    authorizeDispatch: async ({ sender, key, event, currentState }) => {
      const appId = await requireExistingChat(key.chatId);
      if (event.type === "SUBMIT") {
        if (event.intent.chatId !== key.chatId) {
          throw new DyadError(
            "Chat intent does not belong to the routed chat",
            DyadErrorKind.Auth,
          );
        }
        if (event.intent.appId !== undefined && event.intent.appId !== appId) {
          throw new DyadError(
            "Chat intent app does not own the routed chat",
            DyadErrorKind.Auth,
          );
        }
        if (
          event.intent.originWindowSessionId &&
          event.intent.originWindowSessionId !== sender.windowSessionId
        ) {
          throw new DyadError(
            "Chat intent origin does not match the sender",
            DyadErrorKind.Auth,
          );
        }
        if (event.intent.owner) {
          throw new DyadError(
            "Main-owned chat intents cannot be submitted by a renderer",
            DyadErrorKind.Auth,
          );
        }
        event.intent.originWindowSessionId = sender.windowSessionId;
      }
      if (
        event.type === "CANCEL" &&
        (!currentState?.active ||
          currentState.active.invocationRef.operationId !==
            event.invocationRef.operationId)
      ) {
        throw new DyadError(
          "Cancellation does not target the active chat stream",
          DyadErrorKind.Auth,
        );
      }
    },
  },
} satisfies DistributedMachineDefinition<
  typeof CHAT_STREAM_MACHINE_ID,
  ChatStreamKey,
  ChatStreamHostState,
  ChatStreamWireEvent,
  ChatStreamHostCommand,
  ChatStreamHostIgnoreReason
>;
