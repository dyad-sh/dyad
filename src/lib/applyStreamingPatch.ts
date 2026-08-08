import type { Message, StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";

/**
 * Applies a tail-only streaming patch to the messages-by-id map atom.
 * Reconstructs the streaming message content as `current.slice(0, offset) + content`.
 *
 * Returns false when the patch cannot be applied cleanly:
 *   - chatId has no local messages yet (missing placeholder)
 *   - streamingMessageId is not found in local messages
 *   - local renderer content is shorter than patch offset (stale DB overwrite dropped bytes)
 *   - djb2 hash of the local prefix disagrees with prefixHash (stale DB content
 *     has same length but different prefix, e.g. a cleanFullResponse < → ＜
 *     rewrite anywhere in the prefix after the DB write)
 * The caller should resync on false instead of splicing a new tail onto the wrong base.
 */
export function applyStreamingPatch(
  setMessagesById: (
    update: (prev: Map<number, Message[]>) => Map<number, Message[]>,
  ) => void,
  chatId: number,
  streamingMessageId: number,
  streamingPatch: StreamingPatch,
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
      if (currentContent.length < offset) {
        baseMismatch = true;
        return msg;
      }
      if (
        prefixHash !== undefined &&
        offset > 0 &&
        hashPrefix(currentContent, offset) !== prefixHash
      ) {
        baseMismatch = true;
        return msg;
      }
      return { ...msg, content: currentContent.slice(0, offset) + content };
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
