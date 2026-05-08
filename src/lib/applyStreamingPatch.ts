import type { Message, StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";

/**
 * Applies a tail-only streaming patch to the messages-by-id map atom.
 * Reconstructs the streaming message content as `current.slice(0, offset) + content`.
 *
 * `priorBytesDropped` is the cumulative number of bytes that the renderer
 * has discarded from the front of the local message.content (see
 * trimToLastNBlocks). Server-side patch offsets are absolute, so the local
 * effective offset is `offset - priorBytesDropped`. When dropped > 0 the
 * prefixHash check is skipped — we no longer have the full prefix bytes to
 * recompute the hash, and the trim is renderer-only / never round-tripped.
 *
 * Returns false when the patch cannot be applied cleanly:
 *   - chatId has no local messages yet (missing placeholder)
 *   - streamingMessageId is not found in local messages
 *   - patch offset is below the dropped boundary (impossible without a rewind)
 *   - local renderer content is shorter than effective offset (stale DB
 *     overwrite dropped bytes)
 *   - djb2 hash of the local prefix disagrees with prefixHash (only checked
 *     when priorBytesDropped === 0)
 * The caller should resync on false instead of splicing a new tail onto the wrong base.
 */
export function applyStreamingPatch(
  setMessagesById: (
    update: (prev: Map<number, Message[]>) => Map<number, Message[]>,
  ) => void,
  chatId: number,
  streamingMessageId: number,
  streamingPatch: StreamingPatch,
  priorBytesDropped = 0,
): boolean {
  const { offset, content, prefixHash } = streamingPatch;
  let baseMismatch = false;
  setMessagesById((prev) => {
    const existingMessages = prev.get(chatId);
    if (!existingMessages) {
      baseMismatch = true;
      return prev;
    }
    let found = false;
    const updated = existingMessages.map((msg) => {
      if (msg.id !== streamingMessageId) return msg;
      found = true;
      const currentContent = msg.content ?? "";
      // Server-side absolute offset → renderer-local offset.
      const effectiveOffset = offset - priorBytesDropped;
      if (effectiveOffset < 0) {
        baseMismatch = true;
        return msg;
      }
      if (currentContent.length < effectiveOffset) {
        baseMismatch = true;
        return msg;
      }
      // Skip prefix-hash check after we've dropped bytes — we no longer have
      // the full prefix to recompute against. cleanFullResponse rewrites
      // past the drop boundary become invisible, but the resync path on
      // applied=false still rescues us if the tail divergence is detectable
      // any other way.
      if (
        priorBytesDropped === 0 &&
        prefixHash !== undefined &&
        effectiveOffset > 0 &&
        hashPrefix(currentContent, effectiveOffset) !== prefixHash
      ) {
        baseMismatch = true;
        return msg;
      }
      return {
        ...msg,
        content: currentContent.slice(0, effectiveOffset) + content,
      };
    });
    if (!found) {
      baseMismatch = true;
      return prev;
    }
    if (baseMismatch) return prev;
    const next = new Map(prev);
    next.set(chatId, updated);
    return next;
  });
  return !baseMismatch;
}
