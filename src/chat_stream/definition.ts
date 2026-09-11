import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db } from "@/db";
import { chats } from "@/db/schema";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  cancelActiveStreamsForChat,
  clearPendingActorStreamCancellation,
  executeChatStreamFromActor,
} from "@/ipc/handlers/chat_stream_handlers";
import {
  chatExecutionEndpoint,
  publishChatInvalidations,
} from "@/ipc/services/chat_actor_platform";
import { assertChatActorAdmissionOpen } from "@/ipc/services/chat_actor_deletion_fence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { readSettings } from "@/main/settings";
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
  parkChatQueue,
  claimQueueHead,
  persistQueuedIntent,
  persistSessionQueuedIntent,
  restoreClaimedQueueHead,
  stageActiveIntent,
} from "./persistence";
import {
  CHAT_STREAM_MAX_DISPATCH_ENVELOPE_BYTES,
  CHAT_STREAM_MAX_SNAPSHOT_ENVELOPE_BYTES,
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
import { canCancelActiveChatStreamPhase } from "./transition";

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
    queuePauseReason: state.queuePauseReason,
    queue: [...state.queue],
    stopPolicyVersion: state.stopPolicyVersion,
    capabilities: {
      canSubmit: true,
      canCancel: canCancelActiveChatStreamPhase(state.phase),
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
  const resumeReviewQueue = async (): Promise<void> => {
    while (true) {
      const snapshot = context.getSnapshot();
      if (!snapshot.queuePaused) return;
      try {
        const queue = await mutateChatQueue(db, context.key.chatId, {
          type: "mutate-queue",
          mutation: { type: "resume", preserveStopPause: true },
          expectedQueueRevision: snapshot.queueRevision,
          mutationId: randomUUID(),
        });
        emit({
          type: "QUEUE_MUTATED",
          queueRevision: queue.queueRevision,
          paused: queue.queuePaused,
          entries: queue.queue,
        });
        return;
      } catch (error) {
        try {
          await requireExistingChat(context.key.chatId);
        } catch {
          // Entity disposal makes the queue irrelevant and disposes the actor.
          return;
        }
        console.error("[chat-stream] Retrying review queue release", error);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
  return async (command: ChatStreamHostCommand): Promise<void> => {
    switch (command.type) {
      case "persist-queued": {
        try {
          const result =
            command.intent.owner?.kind === "user-input-follow-up"
              ? persistSessionQueuedIntent(db, command.intent, {
                  resumeQueue: command.resumeQueue,
                })
              : persistQueuedIntent(db, command.intent, {
                  resumeQueue: command.resumeQueue,
                });
          if (result.kind === "replayed") {
            emit({
              type: "ADMISSION_REPLAYED",
              intentId: command.intent.intentId,
              acceptance: result.acceptance,
              acceptedMessageId: result.acceptedMessageId,
            });
            if (result.queue) {
              emit({
                type: "QUEUE_MUTATED",
                queueRevision: result.queue.queueRevision,
                paused: result.queue.queuePaused,
                entries: result.queue.queue,
                resumeQueue: command.resumeQueue,
                ...(command.observedStopPolicyVersion === undefined
                  ? {}
                  : {
                      observedStopPolicyVersion:
                        command.observedStopPolicyVersion,
                    }),
              });
            }
          } else {
            emit({
              type: "ADMISSION_QUEUED",
              intentId: command.intent.intentId,
              entry: result.entry,
              queueRevision: result.queueRevision,
              queuePaused: result.queuePaused,
              resumeQueue: command.resumeQueue,
              ...(command.observedStopPolicyVersion === undefined
                ? {}
                : {
                    observedStopPolicyVersion:
                      command.observedStopPolicyVersion,
                  }),
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
            return;
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
          const targetAppId = await requireExistingChat(context.key.chatId);
          const current = context.getSnapshot();
          if (
            current.phase === "cancelling" &&
            current.active?.intent.intentId === command.intent.intentId &&
            current.active.invocationRef.operationId ===
              invocationRef.operationId
          ) {
            emit({
              type: "STREAM_ENDED",
              intentId: command.intent.intentId,
              invocationRef,
              response: {
                chatId: context.key.chatId,
                invocationRef,
                updatedFiles: false,
                wasCancelled: true,
              },
              targetAppId,
            });
            return;
          }
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
              planAcceptInNewChat: command.intent.planAcceptInNewChat,
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
        } finally {
          if (command.intent.invocationRef) {
            clearPendingActorStreamCancellation(command.intent.invocationRef);
          }
        }
        return;
      }
      case "cancel-active": {
        try {
          const endpoint = chatExecutionEndpoint(context.key.chatId);
          const cancelled = await cancelActiveStreamsForChat(
            context.key.chatId,
            endpoint,
            command.invocationRef,
          );
          if (cancelled) {
            const active = context.getSnapshot().active;
            if (!active) return;
            const targetAppId =
              active.targetAppId ??
              (await requireExistingChat(context.key.chatId));
            emit({
              type: "STREAM_ENDED",
              intentId: active.intent.intentId,
              invocationRef: command.invocationRef,
              response: {
                chatId: context.key.chatId,
                invocationRef: command.invocationRef,
                updatedFiles: false,
                wasCancelled: true,
              },
              targetAppId,
            });
          }
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
      case "park-queue": {
        try {
          const queue = await parkChatQueue(db, context.key.chatId);
          emit({
            type: "QUEUE_PARKED",
            queueRevision: queue.queueRevision,
            paused: true,
            entries: queue.queue,
          });
        } catch (error) {
          const queue = loadAuthoritativeQueue();
          emit({
            type: "QUEUE_PARK_FAILED",
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
          if (
            command.mutation.type === "resume" &&
            command.observedStopPolicyVersion !== undefined &&
            command.observedStopPolicyVersion !==
              context.getSnapshot().stopPolicyVersion
          ) {
            const queue = loadAuthoritativeQueue();
            emit({
              type: "QUEUE_MUTATION_REJECTED",
              mutationId: command.mutationId,
              error: "A newer Stop changed the queue; try resuming again.",
              queueRevision: queue.queueRevision,
              paused: queue.queuePaused,
              entries: queue.queue,
            });
            return;
          }
          const queue = await mutateChatQueue(db, context.key.chatId, command);
          emit({
            type: "QUEUE_MUTATED",
            mutationId: command.mutationId,
            queueRevision: queue.queueRevision,
            paused: queue.queuePaused,
            entries: queue.queue,
            ...(command.observedStopPolicyVersion === undefined
              ? {}
              : {
                  observedStopPolicyVersion: command.observedStopPolicyVersion,
                }),
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
          const pauseForStepLimit =
            command.response?.pausePromptQueue === true &&
            command.response.reviewBarrierRequested !== true;
          const pauseForReview =
            command.response?.reviewBarrierRequested === true ||
            active.intent.owner?.kind === "review-remediation" ||
            context.getSnapshot().reviewBarrier.phase ===
              "awaiting-continuation";
          const pauseForStop =
            active.queueResumedAfterCancel !== true &&
            active.pauseQueueOnCancel === true;
          const queue = markIntentTerminal(
            db,
            active.intent,
            pauseForStepLimit || pauseForReview || pauseForStop,
            command.error !== undefined ||
              command.response?.wasCancelled === true,
            pauseForStop ? "stop" : pauseForStepLimit ? "step-limit" : "manual",
            command.response?.wasCancelled === true
              ? "cancelled"
              : command.error !== undefined
                ? "errored"
                : "completed",
          );
          publishChatInvalidations(context.key.chatId, active.targetAppId);
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
      case "run-review-barrier": {
        emit({
          type: "REVIEW_BARRIER_FAILED",
          error: "Automatic review is unavailable in this build.",
        });
        return;
      }
      case "submit-review-remediation": {
        emit({
          type: "REVIEW_BARRIER_FAILED",
          error: "Review remediation is unavailable in this build.",
        });
        return;
      }
      case "fail-review-remediation": {
        await resumeReviewQueue();
        return;
      }
      case "resume-after-review": {
        await resumeReviewQueue();
        return;
      }
      case "dispatch-next": {
        try {
          try {
            assertChatActorAdmissionOpen(context.key.chatId);
          } catch {
            return;
          }
          const claimed = await retryQueueDispatchPersistence(() =>
            claimQueueHead(db, context.key.chatId),
          );
          if (claimed) {
            try {
              assertChatActorAdmissionOpen(context.key.chatId);
            } catch {
              const queue = await retryQueueDispatchPersistence(() =>
                restoreClaimedQueueHead(
                  db,
                  context.key.chatId,
                  claimed.intent.intentId,
                ),
              );
              emit({
                type: "QUEUE_MUTATED",
                queueRevision: queue.queueRevision,
                paused: queue.queuePaused,
                entries: queue.queue,
              });
              return;
            }
            const snapshotBeforeDispatch = context.getSnapshot();
            if (
              snapshotBeforeDispatch.queuePaused ||
              (snapshotBeforeDispatch.phase !== "idle" &&
                snapshotBeforeDispatch.phase !== "errored")
            ) {
              const queue = await retryQueueDispatchPersistence(() =>
                restoreClaimedQueueHead(
                  db,
                  context.key.chatId,
                  claimed.intent.intentId,
                ),
              );
              emit({
                type: "QUEUE_MUTATED",
                queueRevision: queue.queueRevision,
                paused: queue.queuePaused,
                entries: queue.queue,
              });
              return;
            }
            // Move the actor out of idle before publishing the shorter queue so
            // that projection refresh cannot schedule a second head concurrently.
            emit({
              type: "SUBMIT",
              intent: claimed.intent,
              observedStopPolicyVersion:
                snapshotBeforeDispatch.stopPolicyVersion,
            });
            emit({
              type: "QUEUE_MUTATED",
              queueRevision: claimed.queue.queueRevision,
              paused: claimed.queue.queuePaused,
              entries: claimed.queue.queue,
            });
          }
        } catch (error) {
          emit({
            type: "REPORT_ERROR",
            error: `Failed to dispatch the next queued message: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        return;
      }
    }
  };
}

async function retryQueueDispatchPersistence<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    // SQLite failures around queue dispatch are commonly transient (for
    // example a briefly busy database). Retry once before surfacing a visible
    // actor error so the queue does not silently stall.
    return operation();
  }
}

export const chatStreamDefinition = {
  id: CHAT_STREAM_MACHINE_ID,
  host: "main",
  initialState: (key) => {
    // Authorization can finish just before deletion installs its fence. Keep
    // the creation boundary fenced too so that race cannot recreate the actor.
    assertChatActorAdmissionOpen(key.chatId);
    return initialChatStreamHostState(
      hydrateChatStreamPersistence(db, key.chatId),
    );
  },
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
    flushOnShutdown: false,
    onDisposed: ({ key, snapshot }) => {
      if (snapshot.active) {
        clearPendingActorStreamCancellation(snapshot.active.invocationRef);
      }
      disposeSessionChatQueue(key.chatId);
    },
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    maxDispatchEnvelopeBytes: CHAT_STREAM_MAX_DISPATCH_ENVELOPE_BYTES,
    maxSnapshotEnvelopeBytes: CHAT_STREAM_MAX_SNAPSHOT_ENVELOPE_BYTES,
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
      assertChatActorAdmissionOpen(key.chatId, DyadErrorKind.Auth);
      await requireExistingChat(key.chatId);
      assertChatActorAdmissionOpen(key.chatId, DyadErrorKind.Auth);
    },
    authorizeDispatch: async ({ sender, key, event, currentState }) => {
      assertChatActorAdmissionOpen(key.chatId, DyadErrorKind.Auth);
      const appId = await requireExistingChat(key.chatId);
      assertChatActorAdmissionOpen(key.chatId, DyadErrorKind.Auth);
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
        if (event.intent.owner || event.intent.userInputRequestId) {
          throw new DyadError(
            "Main-owned follow-up identity cannot be submitted by a renderer",
            DyadErrorKind.Auth,
          );
        }
        if (
          event.observedStopPolicyVersion !== undefined &&
          currentState &&
          event.observedStopPolicyVersion > currentState.stopPolicyVersion
        ) {
          throw new DyadError(
            "Chat submission observed an unknown Stop policy version",
            DyadErrorKind.Auth,
          );
        }
        event.intent.originWindowSessionId = sender.windowSessionId;
      }
      if (event.type === "CANCEL") {
        if (event.invocationRef.entityKey !== key.chatId) {
          throw new DyadError(
            "Cancellation does not belong to the routed chat",
            DyadErrorKind.Auth,
          );
        }
        if (
          event.observedStopPolicyVersion !== undefined &&
          currentState &&
          event.observedStopPolicyVersion > currentState.stopPolicyVersion
        ) {
          throw new DyadError(
            "Chat cancellation observed an unknown Stop policy version",
            DyadErrorKind.Auth,
          );
        }
        if (
          event.pauseQueue !== true &&
          (!currentState?.active ||
            currentState.active.invocationRef.operationId !==
              event.invocationRef.operationId)
        ) {
          throw new DyadError(
            "Cancellation does not target the active chat stream",
            DyadErrorKind.Auth,
          );
        }
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
