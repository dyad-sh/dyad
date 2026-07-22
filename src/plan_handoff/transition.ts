import type {
  HandoffEvent,
  HandoffSession,
  HandoffState,
  PersistedHandoffSession,
  ReadyHandoffSession,
  TransitionResult,
} from "./state";
import { ignore as ignoreTransition } from "@/state_machines/types";

/**
 * How long the "Plan accepted → preparing…" confirmation stays on screen.
 * Intentional UX pause carried over from the legacy saga's `sleep(2500)`.
 */
export const TRANSITION_DISPLAY_MS = 2500;

/**
 * Event not relevant in this state: keep the same state (by reference, so the
 * controller can skip notifying subscribers) and run nothing.
 */
function ignore(
  state: HandoffState,
  reason: NonNullable<TransitionResult["ignoredReason"]>,
): TransitionResult {
  return ignoreTransition(state, reason);
}

function startHandoff(event: {
  chatId: number;
  appId: number;
  acceptInNewChat: boolean;
}): TransitionResult {
  const session: HandoffSession = {
    chatId: event.chatId,
    appId: event.appId,
    acceptInNewChat: event.acceptInNewChat,
  };
  return {
    state: { type: "cancelling-stream", session },
    commands: [
      { type: "mark-plan-accepted", chatId: session.chatId },
      { type: "cancel-stream", chatId: session.chatId },
    ],
  };
}

/**
 * Pure transition function for the plan-handoff machine.
 *
 * `transition(state, event)` returns the next state plus the commands to run.
 * It performs no side effects and imports nothing but types; all effects are
 * described as commands and executed by the controller via the adapter in
 * `commands.ts`.
 */
export function transition(
  state: HandoffState,
  event: HandoffEvent,
): TransitionResult {
  switch (state.type) {
    case "idle":
    case "failed": {
      switch (event.type) {
        // A (re-)accept starts a fresh handoff. From `failed` this is the
        // explicit recovery path: the legacy saga simply bailed out on error
        // and let the user accept the plan again.
        case "PLAN_ACCEPTED":
          return startHandoff(event);
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "cancelling-stream": {
      switch (event.type) {
        case "STREAM_CANCEL_FINISHED":
          return {
            state: { type: "transitioning", session: state.session },
            commands: [{ type: "wait", ms: TRANSITION_DISPLAY_MS }],
          };
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "transitioning": {
      switch (event.type) {
        case "TRANSITION_DISPLAY_DONE":
          return {
            state: { type: "persisting", session: state.session },
            commands: [
              // Legacy behavior: the preview switches back even when the
              // plan data turns out to be missing right after.
              { type: "set-preview-mode", mode: "preview" },
              {
                type: "persist-plan",
                chatId: state.session.chatId,
                appId: state.session.appId,
              },
            ],
          };
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "persisting": {
      switch (event.type) {
        case "PLAN_PERSISTED": {
          const session: PersistedHandoffSession = {
            ...state.session,
            planSlug: event.planSlug,
          };
          return {
            state: { type: "preparing-chat", session },
            commands: [
              session.acceptInNewChat
                ? { type: "create-chat", appId: session.appId }
                : { type: "switch-chat-mode", chatId: session.chatId },
            ],
          };
        }
        case "PLAN_DATA_MISSING":
          return {
            state: {
              type: "failed",
              session: state.session,
              failure: "missing-plan-data",
            },
            commands: [
              { type: "notify-failure", failure: "missing-plan-data" },
            ],
          };
        case "PLAN_PERSIST_FAILED":
          return {
            state: {
              type: "failed",
              session: state.session,
              failure: "persist-plan",
              error: event.error,
            },
            commands: [
              {
                type: "notify-failure",
                failure: "persist-plan",
                error: event.error,
              },
            ],
          };
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "preparing-chat": {
      switch (event.type) {
        case "CHAT_READY": {
          const session: ReadyHandoffSession = {
            ...state.session,
            implementationChatId: event.implementationChatId,
          };
          return {
            state: { type: "awaiting-stream-idle", session },
            commands: [
              // Only the new-chat path navigates; continue-in-current-chat
              // stays where it is.
              ...(session.acceptInNewChat
                ? ([
                    {
                      type: "navigate-to-chat",
                      chatId: event.implementationChatId,
                      appId: session.appId,
                    },
                  ] as const)
                : []),
              { type: "refresh-chat-list" },
              {
                type: "watch-stream-idle",
                chatId: event.implementationChatId,
              },
            ],
          };
        }
        case "CHAT_PREPARE_FAILED":
          return {
            state: {
              type: "failed",
              session: state.session,
              failure: "prepare-chat",
              error: event.error,
            },
            commands: [
              {
                type: "notify-failure",
                failure: "prepare-chat",
                error: event.error,
              },
            ],
          };
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "awaiting-stream-idle": {
      switch (event.type) {
        case "STREAM_BECAME_IDLE": {
          // Only the implementation chat's stream matters here.
          if (event.chatId !== state.session.implementationChatId) {
            return ignore(state, "chat-id-mismatch");
          }
          return {
            state: { type: "implementing", session: state.session },
            commands: [
              {
                type: "start-implementation",
                chatId: event.chatId,
                planSlug: state.session.planSlug,
              },
            ],
          };
        }
        case "PLAN_ACCEPTED": {
          // Unlike the bounded pipeline states above (which always settle on
          // their own), this state waits on an external condition that may
          // never arrive (stuck stream, deleted chat). A fresh accept
          // supersedes the stalled wait: dispose the idle watcher and restart
          // the handoff so the machine cannot be wedged forever.
          const fresh = startHandoff(event);
          return {
            state: fresh.state,
            commands: [
              {
                type: "unwatch-stream-idle",
                chatId: state.session.implementationChatId,
              },
              ...fresh.commands,
            ],
          };
        }
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    case "implementing": {
      switch (event.type) {
        case "IMPLEMENTATION_STARTED":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignore(state, "invalid-in-current-state");
      }
    }

    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
