import type { StreamEvent, StreamState, TransitionResult } from "./state";

/**
 * Pure transition function for the chat stream lifecycle machine.
 *
 * No side effects, no non-type imports. Every (state, event) pair is handled
 * explicitly: deliberately ignored pairs go through `ignore(state)` (which
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
function ignore(state: StreamState): TransitionResult {
  return { state, commands: [] };
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

export function transition(
  state: StreamState,
  event: StreamEvent,
): TransitionResult {
  switch (state.type) {
    case "idle": {
      switch (event.type) {
        case "submit": {
          const streamId = state.lastStreamId + 1;
          return {
            state: { type: "starting", streamId, request: event.request },
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
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
        case "finalize-complete":
          return ignore(state);
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
              sawSyntheticEnd: false,
            },
            commands: [{ type: "request-abort" }],
          };
        case "registered":
          return {
            state: {
              type: "streaming",
              streamId: state.streamId,
              request: state.request,
            },
            commands: [],
          };
        case "chunk-received":
          if (isStale(state, event)) return ignore(state);
          // A chunk implies main registered the stream even if the
          // registration event was missed.
          return {
            state: {
              type: "streaming",
              streamId: state.streamId,
              request: state.request,
            },
            commands: [],
          };
        case "stream-ended":
          if (isStale(state, event)) return ignore(state);
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                response: event.response,
              },
            ],
          };
        case "stream-errored":
          if (isStale(state, event)) return ignore(state);
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
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "finalize-complete":
        case "queue-poked":
          return ignore(state);
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
              sawSyntheticEnd: false,
            },
            commands: [{ type: "request-abort" }],
          };
        case "stream-ended":
          if (isStale(state, event)) return ignore(state);
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                response: event.response,
              },
            ],
          };
        case "stream-errored":
          if (isStale(state, event)) return ignore(state);
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
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "registered":
        case "chunk-received":
        case "finalize-complete":
        case "queue-poked":
          return ignore(state);
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
          if (state.registered) return ignore(state);
          // Cancel raced ahead of main's registration: the earlier abort hit
          // nothing, so re-issue it now that the stream actually exists.
          return {
            state: { ...state, registered: true },
            commands: [{ type: "request-abort" }],
          };
        case "stream-ended": {
          if (isStale(state, event)) return ignore(state);
          if (
            !state.registered &&
            !state.sawSyntheticEnd &&
            event.response.wasCancelled === true
          ) {
            // Synthetic end fabricated by main's cancel handler before the
            // real stream registered. The real stream is still running:
            // stay in `cancelling` and reconcile with its real terminal
            // event (fixes cancel-before-registration).
            return {
              state: { ...state, sawSyntheticEnd: true },
              commands: [],
            };
          }
          return {
            state: {
              type: "finalizing",
              streamId: state.streamId,
              request: state.request,
              wasCancelled: event.response.wasCancelled === true,
            },
            commands: [
              {
                type: "run-end-side-effects",
                streamId: state.streamId,
                request: state.request,
                response: event.response,
              },
            ],
          };
        }
        case "stream-errored":
          if (isStale(state, event)) return ignore(state);
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
                error: event.error,
                warningMessages: event.warningMessages,
              },
            ],
          };
        case "cancel":
        case "chunk-received":
        case "finalize-complete":
        case "queue-poked":
          return ignore(state);
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
          if (isStale(state, event)) return ignore(state);
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
        case "registered":
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
        case "queue-poked":
          return ignore(state);
      }
      break;
    }

    case "errored": {
      switch (event.type) {
        case "submit": {
          const streamId = state.lastStreamId + 1;
          return {
            state: { type: "starting", streamId, request: event.request },
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
        case "chunk-received":
        case "stream-ended":
        case "stream-errored":
        case "finalize-complete":
          return ignore(state);
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
