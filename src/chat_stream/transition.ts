import type {
  ChatStreamIgnoreReason,
  StreamCommand,
  StreamEvent,
  StreamState,
} from "./state";
import {
  ignore as ignoreTransition,
  type TransitionResult,
} from "@/state_machines/types";

/**
 * Pure transition function for the chat stream lifecycle machine.
 *
 * No side effects or platform dependencies. Every (state, event) pair is handled
 * explicitly: deliberately ignored pairs go through `ignore(state, reason)` (which
 * returns the SAME state reference so subscribers are not re-notified), and
 * the outer switch has a `never` exhaustiveness check.
 */

/** True while a stream is active from the user's point of view (drives the `isStreaming` projection). */
export function isStreamActive(state: StreamState): boolean {
  return (
    state.type === "starting" ||
    state.type === "streaming" ||
    state.type === "cancelling"
  );
}

/** Initial state for a freshly created controller. */
export function initialStreamState(): StreamState {
  return { type: "idle", lastStreamId: 0 };
}

/** Explicit marker for deliberately ignored (state, event) pairs. */
function ignore(
  state: StreamState,
  reason: ChatStreamIgnoreReason,
): TransitionResult<StreamState, StreamCommand, ChatStreamIgnoreReason> {
  return ignoreTransition(state, reason);
}

/** Stale-generation guard: events tagged with a streamId other than the active one never advance the machine. */
function isStale(
  state: Extract<
    StreamState,
    { type: "starting" | "streaming" | "cancelling" | "finalizing" }
  >,
  event: Extract<StreamEvent, { streamId: number }>,
): boolean {
  return event.streamId !== state.streamId;
}

/** Registration events from older clients omit streamId and target the current generation. */
function isStaleRegistration(
  state: Extract<
    StreamState,
    { type: "starting" | "streaming" | "cancelling" | "finalizing" }
  >,
  event: Extract<StreamEvent, { type: "registered" }>,
): boolean {
  return event.streamId !== undefined && event.streamId !== state.streamId;
}

export function transition(
  state: StreamState,
  event: StreamEvent,
): TransitionResult<StreamState, StreamCommand, ChatStreamIgnoreReason> {
  switch (state.type) {
    case "idle": {
      switch (event.type) {
        case "submit": {
          const streamId = state.lastStreamId + 1;
          return {
            state: {
              type: "starting",
              streamId,
              request: event.request,
              targetAppId: null,
            },
            commands: [
              { type: "start-stream", streamId, request: event.request },
            ],
          };
        }
        case "queue-poked":
          // Resume/unpause while idle: try to drain the queue. The command is
          // a no-op when the queue is empty or paused.
          return { state, commands: [{ type: "dispatch-next-queued" }] };
        case "cancel":
        case "registered":
        case "stream-context":
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
          return ignore(state, "no-active-stream");
        case "finalize-complete":
          return ignore(state, "not-finalizing");
      }
      break;
    }

    case "starting": {
      switch (event.type) {
        case "submit":
          // A stream is already being started for this chat: queue, never
          // drop (fixes the submit-window message drop).
          return {
            state,
            commands: [{ type: "enqueue-message", request: event.request }],
          };
        case "cancel":
          // Main may not have registered the AbortController yet; go through
          // `cancelling` and reconcile with the real terminal event.
          return {
            state: {
              type: "cancelling",
              streamId: state.streamId,
              request: state.request,
              registered: false,
              targetAppId: state.targetAppId,
            },
            commands: [{ type: "request-abort" }],
          };
        case "registered":
          if (isStaleRegistration(state, event)) {
            return ignore(state, "stale-stream-id");
          }
          return {
            state: {
              type: "streaming",
              streamId: state.streamId,
              request: state.request,
              targetAppId: state.targetAppId,
            },
            commands: [],
          };
        case "stream-context":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          if (event.targetAppId === state.targetAppId) {
            return ignore(state, "already-registered");
          }
          return {
            state: { ...state, targetAppId: event.targetAppId },
            commands: [],
          };
        case "chunk-received":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          // A chunk implies main registered the stream even if the
          // registration event was missed.
          return {
            state: {
              type: "streaming",
              streamId: state.streamId,
              request: state.request,
              targetAppId: state.targetAppId,
            },
            commands: [],
          };
        case "stream-ended":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
              targetAppId: state.targetAppId,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                response: event.response,
              },
            ],
          };
        case "stream-errored":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          return {
            state: {
              type: "errored",
              lastStreamId: state.streamId,
              error: event.error,
            },
            commands: [
              {
                type: "run-error-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "finalize-complete":
          return ignore(state, "not-finalizing");
        case "queue-poked":
          return ignore(state, "stream-active");
      }
      break;
    }

    case "streaming": {
      switch (event.type) {
        case "submit":
          return {
            state,
            commands: [{ type: "enqueue-message", request: event.request }],
          };
        case "cancel":
          return {
            state: {
              type: "cancelling",
              streamId: state.streamId,
              request: state.request,
              registered: true,
              targetAppId: state.targetAppId,
            },
            commands: [{ type: "request-abort" }],
          };
        case "stream-ended":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
              targetAppId: state.targetAppId,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                response: event.response,
              },
            ],
          };
        case "stream-errored":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          return {
            state: {
              type: "errored",
              lastStreamId: state.streamId,
              error: event.error,
            },
            commands: [
              {
                type: "run-error-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "registered":
          return ignore(
            state,
            isStaleRegistration(state, event)
              ? "stale-stream-id"
              : "already-registered",
          );
        case "stream-context":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          if (event.targetAppId === state.targetAppId) {
            return ignore(state, "already-registered");
          }
          return {
            state: { ...state, targetAppId: event.targetAppId },
            commands: [],
          };
        case "chunk-received":
          return ignore(
            state,
            isStale(state, event) ? "stale-stream-id" : "chunk-while-streaming",
          );
        case "finalize-complete":
          return ignore(state, "not-finalizing");
        case "queue-poked":
          return ignore(state, "stream-active");
      }
      break;
    }

    case "cancelling": {
      switch (event.type) {
        case "submit":
          return {
            state,
            commands: [{ type: "enqueue-message", request: event.request }],
          };
        case "registered":
          if (isStaleRegistration(state, event)) {
            return ignore(state, "stale-stream-id");
          }
          if (state.registered) return ignore(state, "already-registered");
          // Cancel raced ahead of main's registration: the earlier abort hit
          // nothing, so re-issue it now that the stream actually exists.
          return {
            state: { ...state, registered: true },
            commands: [{ type: "request-abort" }],
          };
        case "stream-ended": {
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          // Always finalize on a non-stale end, even while `registered` is
          // still false. Main aborts the tracked stream and then sends the
          // SOLE terminal `wasCancelled` end; a stream aborted before
          // admission never sends `chat:stream:start`, so waiting for
          // registration here would deadlock the machine in `cancelling`
          // (the stale check on `streamId` already rejects ends belonging
          // to an older generation).
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
              targetAppId: state.targetAppId,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                response: event.response,
              },
            ],
          };
        }
        case "stream-errored":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          return {
            state: {
              type: "errored",
              lastStreamId: state.streamId,
              error: event.error,
            },
            commands: [
              {
                type: "run-error-side-effects",
                streamId: state.streamId,
                request: state.request,
                targetAppId: state.targetAppId,
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "cancel":
          return ignore(state, "already-cancelling");
        case "stream-context":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          if (event.targetAppId === state.targetAppId) {
            return ignore(state, "already-registered");
          }
          return {
            state: { ...state, targetAppId: event.targetAppId },
            commands: [],
          };
        case "chunk-received":
          return ignore(
            state,
            isStale(state, event) ? "stale-stream-id" : "chunk-while-streaming",
          );
        case "finalize-complete":
          return ignore(state, "not-finalizing");
        case "queue-poked":
          return ignore(state, "stream-active");
      }
      break;
    }

    case "finalizing": {
      switch (event.type) {
        case "submit":
          // Finalization is still flushing side effects; queue and let the
          // finalize-complete transition dispatch it.
          return {
            state,
            commands: [{ type: "enqueue-message", request: event.request }],
          };
        case "finalize-complete": {
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          const shouldDispatch = event.ok && !state.wasCancelled;
          return {
            state: { type: "idle", lastStreamId: state.streamId },
            // Queue dispatch is an explicit command emitted ONLY on this
            // transition (single-dispatch by construction; fixes the queue
            // double-dispatch race).
            commands: shouldDispatch ? [{ type: "dispatch-next-queued" }] : [],
          };
        }
        case "cancel":
          return ignore(state, "too-late-to-cancel");
        case "registered":
          return ignore(
            state,
            isStaleRegistration(state, event)
              ? "stale-stream-id"
              : "already-registered",
          );
        case "stream-context":
          if (isStale(state, event)) return ignore(state, "stale-stream-id");
          if (event.targetAppId === state.targetAppId) {
            return ignore(state, "already-registered");
          }
          return {
            state: { ...state, targetAppId: event.targetAppId },
            commands: [],
          };
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
          return ignore(
            state,
            isStale(state, event) ? "stale-stream-id" : "no-active-stream",
          );
        case "queue-poked":
          return ignore(state, "stream-active");
      }
      break;
    }

    case "errored": {
      switch (event.type) {
        case "submit": {
          const streamId = state.lastStreamId + 1;
          return {
            state: {
              type: "starting",
              streamId,
              request: event.request,
              targetAppId: null,
            },
            commands: [
              { type: "start-stream", streamId, request: event.request },
            ],
          };
        }
        case "queue-poked":
          // Matches legacy resumeQueue semantics: resuming after an error may
          // drain the queue.
          return { state, commands: [{ type: "dispatch-next-queued" }] };
        case "cancel":
        case "registered":
        case "stream-context":
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
          return ignore(state, "no-active-stream");
        case "finalize-complete":
          return ignore(state, "not-finalizing");
      }
      break;
    }

    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }

  // Unreachable: every inner switch above returns for every event type.
  const exhaustiveEvent: never = event;
  return exhaustiveEvent;
}
