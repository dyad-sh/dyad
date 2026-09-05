import type { StreamingPreview } from "@/ipc/types/chat";

type SetPreview = (chatId: number, content: string) => void;

/**
 * Apply a `streamingPreview` field from a chat-stream chunk onto the
 * sidecar overlay store. The server uses `content === ""` as a clear signal
 * emitted after a tool's final XML is committed via `onXmlComplete`.
 *
 * The sidecar SnapshotStore preserves identity on no-op chunks.
 *
 * Used by the chat stream adapter so high-volume tool-XML preview content
 * stays out of the lower-frequency StreamState snapshot.
 */
export function applyPreviewChunk(
  setPreview: SetPreview,
  chatId: number,
  streamingPreview: StreamingPreview | undefined,
): void {
  if (!streamingPreview) return;
  const { content } = streamingPreview;
  setPreview(chatId, content);
}
