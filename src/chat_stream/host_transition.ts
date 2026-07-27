import { sameInvocationRef } from "@/state_machines/invocation_ref";
import { ignore, type TransitionResult } from "@/state_machines/types";
import type { ChatStreamHostCommand, ChatStreamHostState } from "./host_state";
import type { ChatStreamWireEvent } from "./transport";

export type ChatStreamHostIgnoreReason =
  | "stale-invocation"
  | "queue-revision-conflict"
  | "not-cancellable"
  | "not-active"
  | "invalid-host-event";

export function initialChatStreamHostState(input?: {
  queueRevision: number;
  queuePaused: boolean;
  queue: ChatStreamHostState["queue"];
}): ChatStreamHostState {
  return {
    phase: "idle",
    active: null,
    error: null,
    queueRevision: input?.queueRevision ?? 0,
    queuePaused: input?.queuePaused ?? false,
    queue: input?.queue ?? [],
    lastAcceptance: null,
    lastCompletion: null,
    queueMutationPending: false,
    lastQueueMutation: null,
  };
}

function queueMutation(
  state: ChatStreamHostState,
  event: Extract<
    ChatStreamWireEvent,
    {
      type:
        | "PAUSE_QUEUE"
        | "RESUME_QUEUE"
        | "EDIT_QUEUE_ENTRY"
        | "REORDER_QUEUE_ENTRY"
        | "REMOVE_QUEUE_ENTRY"
        | "CLEAR_QUEUE";
    }
  >,
): TransitionResult<
  ChatStreamHostState,
  ChatStreamHostCommand,
  ChatStreamHostIgnoreReason
> {
  if (event.expectedQueueRevision !== state.queueRevision) {
    return ignore(state, "queue-revision-conflict");
  }
  if (state.queueMutationPending) {
    return ignore(state, "queue-revision-conflict");
  }
  const mutation: Extract<
    ChatStreamHostCommand,
    { type: "mutate-queue" }
  >["mutation"] =
    event.type === "PAUSE_QUEUE"
      ? { type: "pause" }
      : event.type === "RESUME_QUEUE"
        ? { type: "resume" }
        : event.type === "EDIT_QUEUE_ENTRY"
          ? {
              type: "edit",
              itemId: event.itemId,
              prompt: event.prompt,
              attachments: event.attachments,
              selectedComponents: event.selectedComponents,
            }
          : event.type === "REORDER_QUEUE_ENTRY"
            ? {
                type: "reorder",
                itemId: event.itemId,
                toIndex: event.toIndex,
              }
            : event.type === "REMOVE_QUEUE_ENTRY"
              ? { type: "remove", itemId: event.itemId }
              : { type: "clear" };
  return {
    kind: "applied",
    state: { ...state, queueMutationPending: true },
    commands: [
      {
        type: "mutate-queue",
        mutation,
        expectedQueueRevision: event.expectedQueueRevision,
        mutationId: event.mutationId,
      },
    ],
  };
}

export function transitionChatStreamHost(
  state: ChatStreamHostState,
  event: ChatStreamWireEvent,
): TransitionResult<
  ChatStreamHostState,
  ChatStreamHostCommand,
  ChatStreamHostIgnoreReason
> {
  switch (event.type) {
    case "SUBMIT": {
      if (state.phase === "idle" || state.phase === "errored") {
        const invocationRef = event.intent.invocationRef;
        if (!invocationRef) {
          return {
            kind: "applied",
            state: {
              ...state,
              error: "Chat submission is missing an invocation identity",
              lastAcceptance: {
                intentId: event.intent.intentId,
                acceptance: "rejected",
                error: "Chat submission is missing an invocation identity",
              },
            },
            commands: [],
          };
        }
        return {
          kind: "applied",
          state: {
            ...state,
            phase: "admitting",
            active: {
              intent: event.intent,
              invocationRef,
              targetAppId: event.intent.appId ?? null,
            },
            error: null,
          },
          commands: [{ type: "admit-and-start", intent: event.intent }],
        };
      }
      return {
        kind: "applied",
        state,
        commands: [{ type: "persist-queued", intent: event.intent }],
      };
    }
    case "CANCEL":
      if (
        !state.active ||
        (state.phase !== "admitting" && state.phase !== "streaming")
      ) {
        return ignore(state, "not-cancellable");
      }
      if (!sameInvocationRef(state.active.invocationRef, event.invocationRef)) {
        return ignore(state, "stale-invocation");
      }
      return {
        kind: "applied",
        state: { ...state, phase: "cancelling" },
        commands: [
          { type: "cancel-active", invocationRef: event.invocationRef },
        ],
      };
    case "REPORT_ERROR":
      return {
        kind: "applied",
        state: {
          ...state,
          phase:
            state.phase === "idle" || state.phase === "errored"
              ? "errored"
              : state.phase,
          error: event.error,
        },
        commands: [],
      };
    case "PAUSE_QUEUE":
    case "RESUME_QUEUE":
    case "EDIT_QUEUE_ENTRY":
    case "REORDER_QUEUE_ENTRY":
    case "REMOVE_QUEUE_ENTRY":
    case "CLEAR_QUEUE":
      return queueMutation(state, event);
    case "ADMISSION_ACCEPTED":
      if (
        !state.active ||
        state.active.intent.intentId !== event.intentId ||
        !sameInvocationRef(state.active.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-invocation");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          phase: "streaming",
          active: { ...state.active, targetAppId: event.targetAppId },
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "message-accepted",
            ...(event.acceptedMessageId === undefined
              ? {}
              : { acceptedMessageId: event.acceptedMessageId }),
          },
        },
        commands: [],
      };
    case "ADMISSION_QUEUED":
      return {
        kind: "applied",
        state: {
          ...state,
          queueRevision: event.queueRevision,
          queue: [...state.queue, event.entry],
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "queued",
          },
        },
        commands: [],
      };
    case "ADMISSION_REPLAYED":
      if (
        state.active?.intent.intentId === event.intentId &&
        event.acceptance !== "queued"
      ) {
        return {
          kind: "applied",
          state: {
            ...state,
            phase: event.acceptance === "rejected" ? "errored" : "idle",
            active: null,
            error:
              event.acceptance === "rejected"
                ? "Chat submission was previously rejected"
                : null,
            lastAcceptance: {
              intentId: event.intentId,
              acceptance: "replayed",
              ...(event.acceptedMessageId === undefined
                ? {}
                : { acceptedMessageId: event.acceptedMessageId }),
            },
          },
          commands:
            state.queuePaused || state.queue.length === 0
              ? []
              : [{ type: "dispatch-next" }],
        };
      }
      return {
        kind: "applied",
        state: {
          ...state,
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "replayed",
            ...(event.acceptedMessageId === undefined
              ? {}
              : { acceptedMessageId: event.acceptedMessageId }),
          },
        },
        commands: [],
      };
    case "ADMISSION_REJECTED":
      if (state.active?.intent.intentId !== event.intentId) {
        return {
          kind: "applied",
          state: {
            ...state,
            lastAcceptance: {
              intentId: event.intentId,
              acceptance: "rejected",
              error: event.error,
            },
          },
          commands: [],
        };
      }
      return {
        kind: "applied",
        state: {
          ...state,
          phase: "errored",
          active: null,
          error: event.error,
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "rejected",
            error: event.error,
          },
        },
        commands: state.queuePaused ? [] : [{ type: "dispatch-next" }],
      };
    case "STREAM_ENDED":
      if (
        !state.active ||
        state.active.intent.intentId !== event.intentId ||
        !sameInvocationRef(state.active.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-invocation");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          phase: "finalizing",
          lastCompletion: {
            intentId: event.intentId,
            invocationRef: event.invocationRef,
            outcome: event.response.wasCancelled ? "cancelled" : "completed",
            chatSummary: event.response.chatSummary,
            pausePromptQueue: event.response.pausePromptQueue,
            updatedFiles: event.response.updatedFiles,
          },
        },
        commands: [
          {
            type: "finalize",
            intentId: event.intentId,
            response: event.response,
          },
        ],
      };
    case "STREAM_ERRORED":
      if (
        !state.active ||
        state.active.intent.intentId !== event.intentId ||
        !sameInvocationRef(state.active.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-invocation");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          phase: "finalizing",
          lastCompletion: {
            intentId: event.intentId,
            invocationRef: event.invocationRef,
            outcome: "errored",
            error: event.error,
          },
        },
        commands: [
          { type: "finalize", intentId: event.intentId, error: event.error },
        ],
      };
    case "QUEUE_MUTATED":
      return {
        kind: "applied",
        state: {
          ...state,
          queueRevision: event.queueRevision,
          queuePaused: event.paused,
          queue: event.entries,
          queueMutationPending: false,
          ...(event.mutationId
            ? {
                lastQueueMutation: {
                  mutationId: event.mutationId,
                  outcome: "applied" as const,
                },
              }
            : {}),
          ...(state.phase === "finalizing"
            ? { phase: "idle" as const, active: null }
            : {}),
        },
        commands:
          !event.paused &&
          event.entries.length > 0 &&
          (state.phase === "finalizing" || state.phase === "idle")
            ? [{ type: "dispatch-next" }]
            : [],
      };
    case "QUEUE_MUTATION_REJECTED":
      return {
        kind: "applied",
        state: {
          ...state,
          queueMutationPending: false,
          lastQueueMutation: {
            mutationId: event.mutationId,
            outcome: "rejected",
            error: event.error,
          },
        },
        commands: [],
      };
  }
}
