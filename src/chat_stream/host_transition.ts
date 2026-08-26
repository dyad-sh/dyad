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
  queuePauseReason?: ChatStreamHostState["queuePauseReason"];
  queue: ChatStreamHostState["queue"];
}): ChatStreamHostState {
  return {
    phase: "idle",
    active: null,
    error: null,
    queueRevision: input?.queueRevision ?? 0,
    queuePaused: input?.queuePaused ?? false,
    queuePauseReason: input?.queuePaused
      ? (input.queuePauseReason ?? "manual")
      : null,
    queue: input?.queue ?? [],
    stopPolicyVersion: 0,
    lastStopId: null,
    lastAcceptance: null,
    lastCompletion: null,
    pendingQueueMutationId: null,
    pendingQueuePauseMutationId: null,
    pendingQueueResumeMutationId: null,
    lastQueueMutation: null,
    reviewBarrier: {
      phase: "idle",
      threadId: null,
      resumeQueueOnRelease: false,
    },
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
  if (state.pendingQueueMutationId !== null) {
    return ignore(state, "queue-revision-conflict");
  }
  const resumesCurrentStop =
    event.type === "RESUME_QUEUE" &&
    event.observedStopPolicyVersion === state.stopPolicyVersion;
  if (
    event.type === "RESUME_QUEUE" &&
    state.queuePauseReason === "stop" &&
    !resumesCurrentStop
  ) {
    return {
      kind: "applied",
      state: {
        ...state,
        lastQueueMutation: {
          mutationId: event.mutationId,
          outcome: "rejected",
          error: "A newer Stop changed the queue; try resuming again.",
        },
      },
      commands: [],
    };
  }
  const mutation: Extract<
    ChatStreamHostCommand,
    { type: "mutate-queue" }
  >["mutation"] =
    event.type === "PAUSE_QUEUE"
      ? { type: "pause" }
      : event.type === "RESUME_QUEUE"
        ? {
            type: "resume",
            preserveStopPause:
              state.queuePauseReason === "stop" && !resumesCurrentStop,
          }
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
    state: {
      ...state,
      pendingQueueMutationId: event.mutationId,
      pendingQueuePauseMutationId:
        event.type === "PAUSE_QUEUE" ? event.mutationId : null,
      pendingQueueResumeMutationId:
        event.type === "RESUME_QUEUE" &&
        resumesCurrentStop &&
        (state.queuePauseReason === "stop" ||
          state.active?.pauseQueueOnCancel === true)
          ? event.mutationId
          : null,
    },
    commands: [
      {
        type: "mutate-queue",
        mutation,
        expectedQueueRevision: event.expectedQueueRevision,
        mutationId: event.mutationId,
        ...(event.type === "RESUME_QUEUE" &&
        event.observedStopPolicyVersion !== undefined
          ? { observedStopPolicyVersion: event.observedStopPolicyVersion }
          : {}),
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
      const predatesLatestStop =
        event.observedStopPolicyVersion !== undefined &&
        event.observedStopPolicyVersion < state.stopPolicyVersion;
      const observesLatestStop =
        event.observedStopPolicyVersion !== undefined &&
        event.observedStopPolicyVersion >= state.stopPolicyVersion;
      const replaysQueuedIntent = state.queue.some(
        (entry) => entry.intentId === event.intent.intentId,
      );
      if (
        (state.phase === "idle" || state.phase === "errored") &&
        (!state.queuePaused ||
          (state.queuePauseReason !== "stop" && !replaysQueuedIntent)) &&
        !predatesLatestStop
      ) {
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
              pauseQueueOnCancel: false,
            },
            error: null,
          },
          commands: [{ type: "admit-and-start", intent: event.intent }],
        };
      }
      return {
        kind: "applied",
        state,
        commands: [
          {
            type: "persist-queued",
            intent: event.intent,
            ...(event.observedStopPolicyVersion === undefined
              ? {}
              : {
                  observedStopPolicyVersion: event.observedStopPolicyVersion,
                }),
            resumeQueue:
              observesLatestStop &&
              state.queuePaused &&
              (state.phase === "idle" || state.phase === "errored") &&
              state.queuePauseReason === "stop",
          },
        ],
      };
    }
    case "CANCEL": {
      const isNewStop =
        event.pauseQueue === true &&
        (event.observedStopPolicyVersion === undefined ||
          event.observedStopPolicyVersion >= state.stopPolicyVersion) &&
        (event.stopId === undefined || event.stopId !== state.lastStopId);
      const stoppedState = isNewStop
        ? {
            ...state,
            stopPolicyVersion: state.stopPolicyVersion + 1,
            lastStopId: event.stopId ?? null,
            queuePaused: true,
            queuePauseReason: "stop" as const,
            pendingQueuePauseMutationId: null,
          }
        : state;
      if (!state.active) {
        return isNewStop
          ? {
              kind: "applied",
              state: stoppedState,
              commands: [{ type: "park-queue" }],
            }
          : ignore(state, "not-cancellable");
      }
      if (!sameInvocationRef(state.active.invocationRef, event.invocationRef)) {
        return isNewStop
          ? {
              kind: "applied",
              state: stoppedState,
              commands: [{ type: "park-queue" }],
            }
          : ignore(state, "stale-invocation");
      }
      if (
        state.phase !== "admitting" &&
        state.phase !== "streaming" &&
        !isNewStop
      ) {
        return ignore(state, "not-cancellable");
      }
      {
        const shouldCancelActive =
          state.phase === "admitting" || state.phase === "streaming";
        const shouldParkQueue = isNewStop;
        const shouldUpdateStopPolicy =
          shouldParkQueue &&
          (!state.active.pauseQueueOnCancel ||
            state.active.queueResumedAfterCancel === true);
        return {
          kind: "applied",
          state:
            shouldCancelActive || shouldUpdateStopPolicy
              ? {
                  ...stoppedState,
                  phase: shouldCancelActive ? "cancelling" : state.phase,
                  active: {
                    ...state.active,
                    pauseQueueOnCancel:
                      shouldParkQueue || state.active.pauseQueueOnCancel,
                    queueResumedAfterCancel: shouldParkQueue
                      ? false
                      : state.active.queueResumedAfterCancel,
                  },
                }
              : stoppedState,
          commands: [
            ...(shouldParkQueue ? [{ type: "park-queue" as const }] : []),
            ...(shouldCancelActive
              ? [
                  {
                    type: "cancel-active" as const,
                    invocationRef: event.invocationRef,
                  },
                ]
              : []),
          ],
        };
      }
    }
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
    case "ADMISSION_QUEUED": {
      const stopOwnsQueue =
        state.queuePauseReason === "stop" ||
        state.active?.pauseQueueOnCancel === true;
      const resumesCurrentStop =
        event.resumeQueue &&
        event.observedStopPolicyVersion === state.stopPolicyVersion;
      const queuePaused =
        event.queuePaused || (stopOwnsQueue && !resumesCurrentStop);
      return {
        kind: "applied",
        state: {
          ...state,
          queueRevision: event.queueRevision,
          queuePaused,
          queuePauseReason: queuePaused
            ? stopOwnsQueue
              ? "stop"
              : state.queuePauseReason
            : null,
          queue: [...state.queue, event.entry],
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "queued",
          },
        },
        commands:
          !queuePaused && (state.phase === "idle" || state.phase === "errored")
            ? [{ type: "dispatch-next" }]
            : [],
      };
    }
    case "ADMISSION_REPLAYED":
      if (
        state.active?.intent.intentId === event.intentId &&
        event.acceptance === "queued"
      ) {
        return {
          kind: "applied",
          state: {
            ...state,
            phase: "idle",
            active: null,
            error: null,
            lastAcceptance: {
              intentId: event.intentId,
              acceptance: "queued",
            },
          },
          commands:
            state.queuePaused || state.queue.length === 0
              ? []
              : [{ type: "dispatch-next" }],
        };
      }
      if (
        state.active?.intent.intentId === event.intentId &&
        state.phase !== "admitting" &&
        event.acceptance === "message-accepted"
      ) {
        return {
          kind: "applied",
          state: {
            ...state,
            lastAcceptance: {
              intentId: event.intentId,
              acceptance: event.acceptance,
              ...(event.acceptedMessageId === undefined
                ? {}
                : { acceptedMessageId: event.acceptedMessageId }),
            },
          },
          commands: [],
        };
      }
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
              acceptance: event.acceptance,
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
            acceptance: event.acceptance,
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
          phase: "finalizing",
          error: event.error,
          lastAcceptance: {
            intentId: event.intentId,
            acceptance: "rejected",
            error: event.error,
          },
          lastCompletion: {
            intentId: event.intentId,
            invocationRef: state.active.invocationRef,
            outcome: "errored",
            error: event.error,
            targetAppId: state.active.targetAppId,
          },
        },
        commands: [
          {
            type: "finalize",
            intentId: event.intentId,
            error: event.error,
          },
        ],
      };
    case "STREAM_ENDED":
      if (
        !state.active ||
        state.active.intent.intentId !== event.intentId ||
        !sameInvocationRef(state.active.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-invocation");
      }
      {
        const pausePromptQueue = event.response.pausePromptQueue === true;
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
              ...(pausePromptQueue ? { pausePromptQueue: true } : {}),
              reviewBarrierRequested: event.response.reviewBarrierRequested,
              suppressAutoReview: event.response.suppressAutoReview,
              updatedFiles: event.response.updatedFiles,
              extraFiles: event.response.extraFiles,
              extraFilesError: event.response.extraFilesError,
              warningMessages: event.response.warningMessages,
              targetAppId: event.targetAppId,
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
      }
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
          error: event.error,
          lastCompletion: {
            intentId: event.intentId,
            invocationRef: event.invocationRef,
            outcome: "errored",
            error: event.error,
            warningMessages: event.warningMessages,
            targetAppId: event.targetAppId,
          },
        },
        commands: [
          {
            type: "finalize",
            intentId: event.intentId,
            error: event.error,
          },
        ],
      };
    case "QUEUE_MUTATED":
      if (
        event.mutationId !== undefined &&
        event.mutationId !== state.pendingQueueMutationId
      ) {
        return ignore(state, "invalid-host-event");
      }
      {
        const pendingQueueMutationId =
          event.mutationId === state.pendingQueueMutationId
            ? null
            : state.pendingQueueMutationId;
        const finalizedIntent =
          state.phase === "finalizing" ? state.active?.intent : undefined;
        const completion =
          state.phase === "finalizing" ? state.lastCompletion : null;
        const isRemediation =
          finalizedIntent?.owner?.kind === "review-remediation";
        const remediationThreadId =
          finalizedIntent?.owner?.kind === "review-remediation"
            ? finalizedIntent.owner.threadId
            : null;
        const isContinuation =
          state.reviewBarrier.phase === "awaiting-continuation" &&
          completion !== null &&
          !isRemediation;
        const pausedByStepLimit =
          completion?.pausePromptQueue === true &&
          completion.reviewBarrierRequested !== true;
        const reviewBarrier = isRemediation
          ? pausedByStepLimit
            ? {
                phase: "awaiting-continuation" as const,
                threadId: remediationThreadId,
                resumeQueueOnRelease: state.reviewBarrier.resumeQueueOnRelease,
              }
            : completion?.outcome === "completed"
              ? {
                  phase: "verifying" as const,
                  threadId: remediationThreadId,
                  resumeQueueOnRelease:
                    state.reviewBarrier.resumeQueueOnRelease,
                }
              : {
                  phase: "idle" as const,
                  threadId: null,
                  resumeQueueOnRelease: false,
                }
          : isContinuation
            ? pausedByStepLimit
              ? state.reviewBarrier
              : completion?.outcome === "completed"
                ? {
                    phase: "verifying" as const,
                    threadId: state.reviewBarrier.threadId,
                    resumeQueueOnRelease:
                      state.reviewBarrier.resumeQueueOnRelease,
                  }
                : {
                    phase: "idle" as const,
                    threadId: null,
                    resumeQueueOnRelease: false,
                  }
            : completion?.reviewBarrierRequested === true
              ? {
                  phase: "reviewing" as const,
                  threadId: null,
                  resumeQueueOnRelease: !state.queuePaused,
                }
              : state.reviewBarrier;
        const reviewCommands: ChatStreamHostCommand[] = isRemediation
          ? pausedByStepLimit
            ? []
            : completion?.outcome === "completed"
              ? [{ type: "run-review-barrier", verification: true }]
              : [
                  {
                    type: "fail-review-remediation",
                    threadId: remediationThreadId!,
                  },
                ]
          : isContinuation
            ? pausedByStepLimit
              ? []
              : completion?.outcome === "completed"
                ? [{ type: "run-review-barrier", verification: true }]
                : state.reviewBarrier.threadId
                  ? [
                      {
                        type: "fail-review-remediation",
                        threadId: state.reviewBarrier.threadId,
                      },
                    ]
                  : [{ type: "resume-after-review" }]
            : completion?.reviewBarrierRequested === true
              ? [
                  {
                    type: "run-review-barrier",
                    verification: false,
                    autoFixPolicy:
                      event.entries.length > 0
                        ? "queued-override"
                        : "user-setting",
                  },
                ]
              : [];
        const resumeStopLatch =
          event.mutationId === state.pendingQueueResumeMutationId &&
          !event.paused &&
          event.observedStopPolicyVersion === state.stopPolicyVersion;
        const queuedAdmissionResumesCurrentStop =
          event.resumeQueue === true &&
          event.observedStopPolicyVersion === state.stopPolicyVersion;
        const resumesCurrentStop =
          resumeStopLatch || queuedAdmissionResumesCurrentStop;
        const staleStopResume =
          event.mutationId === state.pendingQueueResumeMutationId &&
          event.observedStopPolicyVersion !== state.stopPolicyVersion;
        const stopOwnsQueue =
          state.queuePauseReason === "stop" ||
          state.active?.pauseQueueOnCancel === true;
        const queuePaused =
          event.paused || (stopOwnsQueue && !resumesCurrentStop);
        const active =
          resumeStopLatch && state.active
            ? {
                ...state.active,
                pauseQueueOnCancel: false,
                queueResumedAfterCancel: true,
              }
            : state.active;
        const queuePauseReason = !queuePaused
          ? null
          : stopOwnsQueue && !resumesCurrentStop
            ? ("stop" as const)
            : event.mutationId === state.pendingQueuePauseMutationId
              ? ("manual" as const)
              : event.mutationId === undefined &&
                  state.lastCompletion?.pausePromptQueue === true
                ? ("step-limit" as const)
                : state.queuePauseReason;
        return {
          kind: "applied",
          state: {
            ...state,
            queueRevision: event.queueRevision,
            queuePaused,
            queuePauseReason,
            queue: event.entries,
            pendingQueueMutationId,
            reviewBarrier,
            pendingQueuePauseMutationId:
              event.mutationId === state.pendingQueuePauseMutationId
                ? null
                : state.pendingQueuePauseMutationId,
            pendingQueueResumeMutationId:
              event.mutationId === state.pendingQueueResumeMutationId
                ? null
                : state.pendingQueueResumeMutationId,
            active,
            ...(event.mutationId
              ? {
                  lastQueueMutation: {
                    mutationId: event.mutationId,
                    ...(staleStopResume
                      ? {
                          outcome: "rejected" as const,
                          error:
                            "A newer Stop changed the queue; try resuming again.",
                        }
                      : { outcome: "applied" as const }),
                  },
                }
              : {}),
            ...(state.phase === "finalizing"
              ? {
                  phase:
                    state.lastCompletion?.outcome === "errored"
                      ? ("errored" as const)
                      : ("idle" as const),
                  active: null,
                }
              : {}),
          },
          commands:
            reviewCommands.length > 0
              ? reviewCommands
              : pendingQueueMutationId === null &&
                  !queuePaused &&
                  !active?.pauseQueueOnCancel &&
                  event.entries.length > 0 &&
                  (state.phase === "idle" || state.phase === "finalizing")
                ? [{ type: "dispatch-next" }]
                : [],
        };
      }
    case "REVIEW_BARRIER_RESULT":
      if (
        state.reviewBarrier.phase !== "reviewing" &&
        state.reviewBarrier.phase !== "verifying"
      ) {
        return ignore(state, "invalid-host-event");
      }
      if (event.outcome === "waiting") {
        return {
          kind: "applied",
          state: {
            ...state,
            error: "Automatic review timed out.",
            reviewBarrier: {
              phase: "idle",
              threadId: null,
              resumeQueueOnRelease: false,
            },
          },
          commands: state.reviewBarrier.resumeQueueOnRelease
            ? [{ type: "resume-after-review" }]
            : [],
        };
      }
      if (event.outcome === "verification_failed") {
        return {
          kind: "applied",
          state: {
            ...state,
            error:
              "Reviewer found remaining issues after remediation. The queued prompts remain paused for review.",
            reviewBarrier: {
              phase: "idle",
              threadId: event.threadId ?? state.reviewBarrier.threadId,
              resumeQueueOnRelease: false,
            },
          },
          commands: [],
        };
      }
      if (event.outcome === "fix_required" && event.threadId && event.prompt) {
        return {
          kind: "applied",
          state: {
            ...state,
            reviewBarrier: {
              phase: "remediating",
              threadId: event.threadId,
              resumeQueueOnRelease: state.reviewBarrier.resumeQueueOnRelease,
            },
          },
          commands: [
            {
              type: "submit-review-remediation",
              threadId: event.threadId,
              prompt: event.prompt,
              observedStopPolicyVersion: state.stopPolicyVersion,
            },
          ],
        };
      }
      return {
        kind: "applied",
        state: {
          ...state,
          reviewBarrier: {
            phase: "idle",
            threadId: null,
            resumeQueueOnRelease: false,
          },
        },
        commands: state.reviewBarrier.resumeQueueOnRelease
          ? [{ type: "resume-after-review" }]
          : [],
      };
    case "REVIEW_BARRIER_FAILED":
      if (state.reviewBarrier.phase === "idle") {
        return ignore(state, "invalid-host-event");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          error: event.error,
          reviewBarrier: {
            phase: "idle",
            threadId: null,
            resumeQueueOnRelease: false,
          },
        },
        commands: state.reviewBarrier.resumeQueueOnRelease
          ? [{ type: "resume-after-review" }]
          : [],
      };
    case "QUEUE_MUTATION_REJECTED":
      if (event.mutationId !== state.pendingQueueMutationId) {
        return ignore(state, "invalid-host-event");
      }
      {
        const stopOwnsQueue =
          state.queuePauseReason === "stop" ||
          state.active?.pauseQueueOnCancel === true;
        return {
          kind: "applied",
          state: {
            ...state,
            queueRevision: event.queueRevision,
            queuePaused: stopOwnsQueue || event.paused,
            queuePauseReason: stopOwnsQueue
              ? "stop"
              : event.paused
                ? state.queuePauseReason
                : null,
            queue: event.entries,
            pendingQueueMutationId: null,
            pendingQueuePauseMutationId:
              event.mutationId === state.pendingQueuePauseMutationId
                ? null
                : state.pendingQueuePauseMutationId,
            pendingQueueResumeMutationId:
              event.mutationId === state.pendingQueueResumeMutationId
                ? null
                : state.pendingQueueResumeMutationId,
            lastQueueMutation: {
              mutationId: event.mutationId,
              outcome: "rejected",
              error: event.error,
            },
          },
          commands: [],
        };
      }
    case "QUEUE_PARKED":
      if (event.queueRevision < state.queueRevision) {
        return ignore(state, "invalid-host-event");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          queueRevision: event.queueRevision,
          queuePaused: true,
          queuePauseReason: "stop",
          queue: event.entries,
        },
        commands: [],
      };
    case "QUEUE_PARK_FAILED":
      if (event.queueRevision < state.queueRevision) {
        return ignore(state, "invalid-host-event");
      }
      {
        const stopOwnsQueue =
          state.queuePauseReason === "stop" ||
          state.active?.pauseQueueOnCancel === true;
        return {
          kind: "applied",
          state: {
            ...state,
            error: event.error,
            queueRevision: event.queueRevision,
            queuePaused: stopOwnsQueue || event.paused,
            queuePauseReason: stopOwnsQueue
              ? "stop"
              : event.paused
                ? state.queuePauseReason
                : null,
            queue: event.entries,
          },
          commands: [],
        };
      }
    case "LIFECYCLE_COMMAND_FAILED":
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
          phase: "errored",
          active: null,
          error: event.error,
          queueRevision: event.queueRevision,
          queuePaused: event.paused,
          queuePauseReason: event.paused ? state.queuePauseReason : null,
          queue: event.entries,
          lastCompletion: {
            intentId: event.intentId,
            invocationRef: event.invocationRef,
            outcome: "errored",
            error: event.error,
            targetAppId: state.active.targetAppId,
          },
        },
        commands: state.active.pauseQueueOnCancel
          ? [{ type: "park-queue" }]
          : [],
      };
  }
}
