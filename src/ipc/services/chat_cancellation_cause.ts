import {
  CancellationReason,
  type CancellationCause,
} from "@/shared/cancellation_reason";

/**
 * Causes scoped to a chat while a caller cancels its turn for a known reason.
 *
 * The chat actor cancels through an asynchronous `cancel-active` command whose
 * wire events carry no cause, so callers that cancel for a reason (deleting the
 * chat, restoring a version) scope that reason here while they wait, and the
 * stream abort reads it. Outside any scope a cancellation is the user's Stop.
 *
 * Overlapping cancellers each scope a cause before their `CANCEL` is queued,
 * and the actor acts only on the first one (a later `CANCEL` for the turn it is
 * already cancelling is ignored), so the earliest scope is the real cause.
 */
const scopedCauses = new Map<number, { cause: CancellationCause }[]>();

export function beginChatCancellationCause(
  chatId: number,
  cause: CancellationCause,
): () => void {
  const entry = { cause };
  const entries = scopedCauses.get(chatId) ?? [];
  entries.push(entry);
  scopedCauses.set(chatId, entries);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = scopedCauses.get(chatId);
    if (!current) return;
    const index = current.indexOf(entry);
    if (index !== -1) current.splice(index, 1);
    if (current.length === 0) scopedCauses.delete(chatId);
  };
}

/** The abort reason for cancelling this chat's turn right now. */
export function chatCancellationReason(
  chatId: number,
  fallback: CancellationCause = "chat-stop",
): CancellationReason {
  const entries = scopedCauses.get(chatId);
  return new CancellationReason(entries?.[0]?.cause ?? fallback);
}
