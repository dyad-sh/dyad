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
  "chatId" | "invocationRef" | "streamId"
>;
export type ChatStreamChunkPayload = ChatResponseChunk;
export type ChatStreamEndPayload = ChatResponseEnd;
export type ChatStreamErrorPayload = Pick<
  ChatResponseEnd,
  "chatId" | "invocationRef" | "streamId" | "warningMessages"
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
 * A request may carry a renderer-minted `invocationRef`. Main echoes the full
 * ref on start, chunk, end, and error payloads. Payloads with a mismatched ref
 * are reported using the existing `stale-stream-id` trace reason to keep chat
 * stream telemetry stable. Payloads without a ref retain legacy key-only
 * routing for in-flight streams crossing an app update.
 */
export const CHAT_STREAM_GENERATION_ECHO_CONTRACT =
  "optional InvocationRef is echoed; present-and-mismatched events are stale-stream-id" as const;
