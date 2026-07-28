import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const deletionCounts = new Map<number, number>();

export function beginChatActorDeletion(chatId: number): () => void {
  deletionCounts.set(chatId, (deletionCounts.get(chatId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (deletionCounts.get(chatId) ?? 1) - 1;
    if (next === 0) {
      deletionCounts.delete(chatId);
    } else {
      deletionCounts.set(chatId, next);
    }
  };
}

export function assertChatActorAdmissionOpen(
  chatId: number,
  errorKind: DyadErrorKind = DyadErrorKind.Precondition,
): void {
  if (!deletionCounts.has(chatId)) return;
  throw new DyadError("Chat is being deleted", errorKind);
}
