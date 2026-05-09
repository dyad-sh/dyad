import type { Message, StreamingPatch } from "@/ipc/types";
import { hashPrefix } from "@/lib/prefixHash";

/**
 * Pure splice. Validates a tail-only streaming patch against the current
 * renderer-local content and returns the new content (or a mismatch).
 *
 * `priorBytesDropped` is the cumulative number of bytes the renderer has
 * discarded from the front of message.content (see trimContent). Server-
 * side patch offsets are absolute, so the local effective offset is
 * `offset - priorBytesDropped`. When dropped > 0 the prefixHash check is
 * skipped — we no longer have the full prefix bytes to recompute the hash,
 * and the trim is renderer-only / never round-tripped.
 *
 * Mismatches:
 *   - effective offset is negative (impossible without a rewind)
 *   - current content is shorter than the effective offset (stale base)
 *   - djb2 hash of the local prefix disagrees with prefixHash (only
 *     checked when priorBytesDropped === 0)
 */
export function applyStreamingPatchPure(
  currentContent: string,
  patch: StreamingPatch,
  priorBytesDropped = 0,
): { applied: true; content: string } | { applied: false } {
  const { offset, content, prefixHash } = patch;
  const effectiveOffset = offset - priorBytesDropped;
  if (effectiveOffset < 0) return { applied: false };
  if (currentContent.length < effectiveOffset) return { applied: false };
  if (
    priorBytesDropped === 0 &&
    prefixHash !== undefined &&
    effectiveOffset > 0 &&
    hashPrefix(currentContent, effectiveOffset) !== prefixHash
  ) {
    return { applied: false };
  }
  return {
    applied: true,
    content: currentContent.slice(0, effectiveOffset) + content,
  };
}

/**
 * Applies a tail-only streaming patch to the messages-by-id map atom.
 * Thin atom-writing wrapper around applyStreamingPatchPure for callers
 * that don't need the incremental parser pipeline (plan implementation,
 * merge-conflict resolution). Returns false on mismatch; the caller
 * should resync rather than splice onto the wrong base.
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
  let applied = false;
  setMessagesById((prev) => {
    const existingMessages = prev.get(chatId);
    if (!existingMessages) return prev;
    const msg = existingMessages.find((m) => m.id === streamingMessageId);
    if (!msg) return prev;
    const result = applyStreamingPatchPure(
      msg.content ?? "",
      streamingPatch,
      priorBytesDropped,
    );
    if (!result.applied) return prev;
    applied = true;
    const updated = existingMessages.map((m) =>
      m.id === streamingMessageId ? { ...m, content: result.content } : m,
    );
    const next = new Map(prev);
    next.set(chatId, updated);
    return next;
  });
  return applied;
}
