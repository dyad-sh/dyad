import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const admissionBlockCounts = new Map<number, number>();

export function beginChatActorMutation(chatId: number): () => void {
  admissionBlockCounts.set(chatId, (admissionBlockCounts.get(chatId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (admissionBlockCounts.get(chatId) ?? 1) - 1;
    if (next === 0) {
      admissionBlockCounts.delete(chatId);
    } else {
      admissionBlockCounts.set(chatId, next);
    }
  };
}

export const beginChatActorDeletion = beginChatActorMutation;

export function assertChatActorAdmissionOpen(
  chatId: number,
  errorKind: DyadErrorKind = DyadErrorKind.Precondition,
): void {
  if (!admissionBlockCounts.has(chatId)) return;
  throw new DyadError("Chat is temporarily unavailable", errorKind);
}
