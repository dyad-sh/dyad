/**
 * Types for the plan-handoff state machine: the flow that runs from the
 * moment a plan is accepted (`plan:exit` IPC event) until the implementation
 * stream has been started in the target chat.
 *
 * This file contains types only. The pure transition function lives in
 * `transition.ts`, the runtime in `controller.ts`, and the side-effecting
 * command implementations in `commands.ts`.
 */

/**
 * Data captured for one accepted plan. `chatId` is the chat the plan was
 * accepted in and is immutable for the lifetime of the session.
 */
export interface HandoffSession {
  readonly chatId: number;
  readonly appId: number;
  readonly acceptInNewChat: boolean;
}

/** Session after the plan has been written to `.dyad/plans/`. */
export interface PersistedHandoffSession extends HandoffSession {
  readonly planSlug: string;
}

/**
 * Session once the implementation chat exists. `implementationChatId` is set
 * exactly once and equals `chatId` for the continue-in-current-chat path.
 * States that start the implementation carry this type, so an absent
 * `planSlug`/`implementationChatId` is unrepresentable there.
 */
export interface ReadyHandoffSession extends PersistedHandoffSession {
  readonly implementationChatId: number;
}

/** Why a handoff landed in the `failed` state. */
export type HandoffFailure =
  | "missing-plan-data"
  | "persist-plan"
  | "prepare-chat";

export type HandoffState =
  /** No handoff in flight for this chat. */
  | { readonly type: "idle" }
  /** Plan accepted; cancelling the in-flight planning stream. */
  | { readonly type: "cancelling-stream"; readonly session: HandoffSession }
  /** Showing the "Plan accepted" transition UI for a fixed duration. */
  | { readonly type: "transitioning"; readonly session: HandoffSession }
  /** Persisting the plan to `.dyad/plans/`. */
  | { readonly type: "persisting"; readonly session: HandoffSession }
  /** Creating the new implementation chat, or switching the current one to Agent mode. */
  | {
      readonly type: "preparing-chat";
      readonly session: PersistedHandoffSession;
    }
  /** Waiting for the implementation chat's stream to be idle before sending. */
  | {
      readonly type: "awaiting-stream-idle";
      readonly session: ReadyHandoffSession;
    }
  /** Starting the implementation stream. */
  | { readonly type: "implementing"; readonly session: ReadyHandoffSession }
  /**
   * Terminal error state. Matches the legacy saga's behavior: the flow stops,
   * the failure is reported (toast or console), and the user may accept the
   * plan again, which restarts the handoff from scratch.
   */
  | {
      readonly type: "failed";
      readonly session: HandoffSession;
      readonly failure: HandoffFailure;
      readonly error?: string;
    };

export type HandoffEvent =
  /** The user accepted the plan (`plan:exit` arrived from the main process). */
  | {
      readonly type: "PLAN_ACCEPTED";
      readonly chatId: number;
      readonly appId: number;
      readonly acceptInNewChat: boolean;
    }
  /** `cancel-stream` finished (success or logged failure — legacy continues either way). */
  | { readonly type: "STREAM_CANCEL_FINISHED" }
  /** The `wait` command for the transition UI completed. */
  | { readonly type: "TRANSITION_DISPLAY_DONE" }
  /** `persist-plan` succeeded. */
  | { readonly type: "PLAN_PERSISTED"; readonly planSlug: string }
  /** `persist-plan` found no plan content for the chat. */
  | { readonly type: "PLAN_DATA_MISSING" }
  /** `persist-plan` failed. */
  | { readonly type: "PLAN_PERSIST_FAILED"; readonly error: string }
  /** The implementation chat exists and is in Agent mode. */
  | { readonly type: "CHAT_READY"; readonly implementationChatId: number }
  /** `create-chat` / `switch-chat-mode` failed. */
  | { readonly type: "CHAT_PREPARE_FAILED"; readonly error: string }
  /**
   * The stream for `chatId` is idle. Fed by the adapter, which today observes
   * `isStreamingByIdAtom`; the machine only consumes the event, so the event
   * source can be swapped without touching the machine.
   */
  | { readonly type: "STREAM_BECAME_IDLE"; readonly chatId: number }
  /** The implementation stream has been started. */
  | { readonly type: "IMPLEMENTATION_STARTED" };

export type HandoffCommand =
  /** Add the chat to `planStateAtom.acceptedChatIds`. */
  | { readonly type: "mark-plan-accepted"; readonly chatId: number }
  /** Cancel the in-flight stream for the chat. Emits STREAM_CANCEL_FINISHED. */
  | { readonly type: "cancel-stream"; readonly chatId: number }
  /** Wait `ms`, then emit TRANSITION_DISPLAY_DONE. The controller holds no timers. */
  | { readonly type: "wait"; readonly ms: number }
  /** Switch the preview panel back to app preview. */
  | { readonly type: "set-preview-mode"; readonly mode: "preview" }
  /**
   * Persist the plan to disk. Reads the latest plan content for the chat and
   * emits PLAN_PERSISTED, PLAN_DATA_MISSING, or PLAN_PERSIST_FAILED.
   */
  | {
      readonly type: "persist-plan";
      readonly chatId: number;
      readonly appId: number;
    }
  /** Create a fresh Agent-mode chat. Emits CHAT_READY or CHAT_PREPARE_FAILED. */
  | { readonly type: "create-chat"; readonly appId: number }
  /** Switch the current chat to Agent mode. Emits CHAT_READY or CHAT_PREPARE_FAILED. */
  | { readonly type: "switch-chat-mode"; readonly chatId: number }
  /** Select and navigate to the (new) implementation chat. */
  | {
      readonly type: "navigate-to-chat";
      readonly chatId: number;
      readonly appId: number;
    }
  /** Invalidate the chat list queries so the sidebar/mode selector refresh. */
  | { readonly type: "refresh-chat-list" }
  /**
   * Start (or replace) a watcher that emits STREAM_BECAME_IDLE(chatId) once
   * the chat's stream is idle — immediately if it already is. Non-blocking:
   * the watcher lives outside the command queue and disposes itself when it
   * fires; `unwatch-stream-idle` disposes it without firing.
   */
  | { readonly type: "watch-stream-idle"; readonly chatId: number }
  /** Dispose the idle watcher for the chat, if any, without emitting. */
  | { readonly type: "unwatch-stream-idle"; readonly chatId: number }
  /** Start the `/implement-plan=` stream. Emits IMPLEMENTATION_STARTED. */
  | {
      readonly type: "start-implementation";
      readonly chatId: number;
      readonly planSlug: string;
    }
  /** Report a failure the way the legacy saga did (toast or console.error). */
  | {
      readonly type: "notify-failure";
      readonly failure: HandoffFailure;
      readonly error?: string;
    };

export type TransitionResult =
  import("@/state_machines/types").TransitionResult<
    HandoffState,
    HandoffCommand,
    "invalid-in-current-state" | "chat-id-mismatch"
  >;
