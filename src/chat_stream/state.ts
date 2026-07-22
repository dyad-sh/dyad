import type {
  Chat,
  ChatResponseEnd,
  ComponentSelection,
  FileAttachment,
} from "@/ipc/types";

/**
 * Chat stream lifecycle state machine types.
 *
 * This file contains TYPES ONLY. The pure transition function lives in
 * `transition.ts`, side effects in `commands.ts`, and the per-chat driver in
 * `controller.ts`.
 */

/** Result reported back to the caller that submitted a stream request. */
export interface StreamSettledResult {
  /**
   * True only when the stream ran to successful completion. Queued
   * submissions settle immediately with `success: false, queued: true` —
   * callers key completion-only side effects off `success`, and the queued
   * message has not run yet.
   */
  success: boolean;
  pausedByStepLimit?: boolean;
  /**
   * True when the submission was accepted and placed on the prompt queue
   * (because a stream was already active for this chat) instead of being
   * streamed immediately. The queued message will run later; its `onSettled`
   * is not carried through the queue (items can be edited or deleted before
   * they run).
   */
  queued?: boolean;
}

/** A single stream submission (the renderer-side "send this prompt" intent). */
export interface StreamRequest {
  prompt: string;
  chatId: number;
  appId?: number;
  redo?: boolean;
  attachments?: FileAttachment[];
  selectedComponents?: ComponentSelection[];
  /**
   * Chat mode requested by the caller. `null` means "let the main process
   * resolve it" (skips the cached-chat fallback), mirroring the legacy
   * `streamMessage` contract.
   */
  requestedChatMode?: Chat["chatMode"] | null;
  onSettled?: (result: StreamSettledResult) => void;
}

/**
 * Per-chat stream lifecycle state.
 *
 * Happy path: idle -> starting -> streaming -> finalizing -> idle.
 *
 * - `starting`: the renderer has invoked `chat:stream` but the main process
 *   has not yet confirmed registration of its AbortController (confirmed via
 *   the `chat:stream:start` event, or implicitly by the first chunk).
 * - `cancelling`: the user requested a cancel while a stream was in flight.
 *   `registered` records whether main had confirmed registration when we last
 *   checked. Main tracks the AbortController synchronously when `chat:stream`
 *   arrives (before `chat:stream:start` is sent), so an abort issued while
 *   still unregistered normally aborts the real stream — whose sole terminal
 *   `wasCancelled` end then arrives with `registered` still false and MUST
 *   finalize (main never sends `chat:stream:start` for a stream aborted
 *   before admission). If the abort instead raced ahead of `chat:stream`
 *   entirely, main found nothing, sent nothing, and the stream proceeds to
 *   registration — the `registered` event re-issues the abort.
 * - `finalizing`: the terminal end event arrived; end side effects (DB
 *   re-sync, invalidations, file refresh) are running.
 * - `errored`: the stream terminated with an error. A new submit is allowed.
 *
 * `streamId` is a per-chat monotonic generation number; events carrying a
 * stale `streamId` never advance the machine.
 */
export type StreamState =
  | { type: "idle"; lastStreamId: number }
  | {
      type: "starting";
      streamId: number;
      request: StreamRequest;
      targetAppId: number | null;
    }
  | {
      type: "streaming";
      streamId: number;
      request: StreamRequest;
      targetAppId: number | null;
    }
  | {
      type: "cancelling";
      streamId: number;
      request: StreamRequest;
      registered: boolean;
      targetAppId: number | null;
    }
  | {
      type: "finalizing";
      streamId: number;
      request: StreamRequest;
      wasCancelled: boolean;
      targetAppId: number | null;
    }
  | { type: "errored"; lastStreamId: number; error: string };

/** Events fed into the machine (from React, the IPC stream client, or the controller itself). */
export type StreamEvent =
  /** A caller wants to stream a prompt for this chat. */
  | { type: "submit"; request: StreamRequest }
  /** The user asked to cancel the active stream. */
  | { type: "cancel" }
  /** Main confirmed AbortController registration (`chat:stream:start`). Absent streamId means the current generation. */
  | { type: "registered"; streamId?: number }
  /** The command adapter resolved the app targeted by this stream. */
  | { type: "stream-context"; streamId: number; targetAppId: number | null }
  /** A content chunk arrived for the given stream generation. */
  | { type: "chunk-received"; streamId: number }
  /** The terminal end event arrived for the given stream generation. */
  | { type: "stream-ended"; streamId: number; response: ChatResponseEnd }
  /** The terminal error event arrived for the given stream generation. */
  | {
      type: "stream-errored";
      streamId: number;
      error: string;
      warningMessages?: string[];
    }
  /** End side effects finished executing (emitted by the controller). */
  | { type: "finalize-complete"; streamId: number; ok: boolean }
  /** The queue may have become dispatchable (resume clicked, etc.). */
  | { type: "queue-poked" };

/** Commands are pure data returned by `transition`; the controller executes them via `ChatStreamCommands`. */
export type StreamCommand =
  /** Convert attachments and invoke `chat:stream` for a new stream generation. */
  | { type: "start-stream"; streamId: number; request: StreamRequest }
  /** Append a submission to the prompt queue (stream already active). */
  | { type: "enqueue-message"; request: StreamRequest }
  /** Ask main to abort the active stream (`chat:cancel`). */
  | { type: "request-abort" }
  /** Run all end-of-stream side effects (cancellation notice, refreshes, DB re-sync merge, ...). */
  | {
      type: "run-end-side-effects";
      streamId: number;
      request: StreamRequest;
      targetAppId: number | null;
      response: ChatResponseEnd;
    }
  /** Run all error side effects (error atom, invalidations, DB re-sync). */
  | {
      type: "run-error-side-effects";
      streamId: number;
      request: StreamRequest;
      targetAppId: number | null;
      error: string;
      warningMessages?: string[];
    }
  /** Pop the next queued message (if any, and not paused) and submit it. */
  | { type: "dispatch-next-queued" };

/** Stable telemetry tags for deliberately ignored stream events. */
export type ChatStreamIgnoreReason =
  | "no-active-stream"
  | "stale-stream-id"
  | "already-registered"
  | "already-cancelling"
  | "chunk-while-streaming"
  | "not-finalizing"
  | "stream-active"
  | "too-late-to-cancel";
