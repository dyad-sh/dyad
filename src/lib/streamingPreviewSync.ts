import type { SetStateAction } from "react";
import type { StreamingPreview } from "@/ipc/types/chat";

type PreviewMap = Map<number, string>;
type SetPreviewAtom = (update: SetStateAction<PreviewMap>) => void;

/**
 * Apply a `streamingPreview` field from a chat-stream chunk onto the
 * sidecar overlay atom. The server uses `content === ""` as a clear
 * signal (emitted after a tool's final XML is committed via
 * `onXmlComplete`), so we delete the entry instead of storing an empty
 * string.
 *
 * Returns identity-stable maps when nothing changed, so atom subscribers
 * keep their `Object.is` short-circuit on no-op chunks.
 *
 * Used by every `ipc.chatStream.start` consumer (useStreamChat,
 * usePlanImplementation, useResolveMergeConflictsWithAI). Without this
 * helper, tool-XML preview streaming would only surface in the
 * useStreamChat flow.
 */
export function applyPreviewChunk(
  setStreamingPreviewByChatId: SetPreviewAtom,
  chatId: number,
  streamingPreview: StreamingPreview | undefined,
): void {
  if (!streamingPreview) return;
  const { content } = streamingPreview;
  setStreamingPreviewByChatId((prev) => {
    const existing = prev.get(chatId);
    if (content === "") {
      if (existing === undefined) return prev;
      const next = new Map(prev);
      next.delete(chatId);
      return next;
    }
    if (existing === content) return prev;
    const next = new Map(prev);
    next.set(chatId, content);
    return next;
  });
}

/**
 * Clear any active preview overlay for `chatId`. Call on stream end,
 * error, and cancellation so a stale overlay never outlives the stream
 * that produced it.
 */
export function clearPreviewForChat(
  setStreamingPreviewByChatId: SetPreviewAtom,
  chatId: number,
): void {
  setStreamingPreviewByChatId((prev) => {
    if (!prev.has(chatId)) return prev;
    const next = new Map(prev);
    next.delete(chatId);
    return next;
  });
}
