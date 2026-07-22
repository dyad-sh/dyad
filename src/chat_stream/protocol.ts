import type {
  ChatResponseChunk,
  ChatResponseEnd,
  ChatStreamParams,
} from "@/ipc/types";

/** Wire names used by the main-to-renderer chat stream protocol. */
export const CHAT_STREAM_WIRE_EVENTS = {
  invoke: "chat:stream",
  start: "chat:stream:start",
  chunk: "chat:response:chunk",
  end: "chat:response:end",
  error: "chat:response:error",
  transportEnd: "chat:stream:end",
} as const;

export type ChatStreamRequestPayload = ChatStreamParams;
export type ChatStreamStartPayload = Pick<
  ChatStreamParams,
  "chatId" | "streamId"
>;
export type ChatStreamChunkPayload = ChatResponseChunk;
export type ChatStreamEndPayload = ChatResponseEnd;
export type ChatStreamErrorPayload = Pick<
  ChatResponseEnd,
  "chatId" | "streamId" | "warningMessages"
> & { error: string };
export type ChatStreamTransportEndPayload = Pick<ChatStreamParams, "chatId">;

/**
 * Electron `webContents.send` delivery is assumed FIFO for a renderer. The
 * co-simulation suite therefore uses one FIFO main-to-renderer queue while
 * exploring every interleaving with main, renderer, and scenario actions.
 */
export const CHAT_STREAM_FIFO_DELIVERY_ASSUMPTION =
  "main-to-renderer chat stream events are delivered FIFO" as const;

/**
 * A request may carry a renderer-allocated `streamId`. Main echoes that value
 * on start, chunk, end, and error payloads. The stream client accepts an absent
 * ID for legacy key-only routing, but drops every present ID that does not match
 * the currently registered generation.
 */
export const CHAT_STREAM_GENERATION_ECHO_CONTRACT =
  "optional streamId is echoed; present-and-mismatched events are dropped" as const;

/**
 * Current per-generation emission contract (intentionally not exactly-one):
 *
 * - `cancelTrackedStreams` is the sole `wasCancelled: true` sender and emits
 *   the cancelled response end plus `chat:stream:end` before awaiting unwind.
 * - A handler emits at most one non-cancelled response end. The apply-error
 *   path may emit response error and response end together.
 * - Cancellation during awaits after the final abort check can produce the
 *   cancel path's early terminals followed by a late handler terminal.
 * - The outer catch emits response error even when the controller is aborted.
 *
 * Consequently late or duplicate handler terminals after cancellation are
 * legal. Renderer generation checks and terminal-state ignores absorb them.
 */
export const CHAT_STREAM_PER_GENERATION_EMISSION_CONTRACT =
  "cancel is the sole cancelled-end sender; late and duplicate handler terminals are legal" as const;

/** I1: admission never fires while a covering chat or app barrier is held. */
export const CHAT_STREAM_INVARIANT_I1 =
  "atomic barrier-respecting admission" as const;
/** I2: only cancellation emits `wasCancelled`, and aborted finalization emits no transport end. */
export const CHAT_STREAM_INVARIANT_I2 = "cancelled-end sole sender" as const;
/** I3: early cancellation notification cannot admit a stream through a held barrier. */
export const CHAT_STREAM_INVARIANT_I3 =
  "early-notify admission safety" as const;
/** I4: released barriers leave no counts or parked admission waiters at quiescence. */
export const CHAT_STREAM_INVARIANT_I4 =
  "barrier hygiene at quiescence" as const;
