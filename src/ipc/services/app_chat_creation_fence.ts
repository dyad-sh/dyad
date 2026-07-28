import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const deletionCounts = new Map<number, number>();

export function beginAppChatDeletion(appId: number): () => void {
  deletionCounts.set(appId, (deletionCounts.get(appId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (deletionCounts.get(appId) ?? 1) - 1;
    if (next === 0) {
      deletionCounts.delete(appId);
    } else {
      deletionCounts.set(appId, next);
    }
  };
}

export function assertAppChatCreationOpen(appId: number): void {
  if (!deletionCounts.has(appId)) return;
  throw new DyadError("App is being deleted", DyadErrorKind.Precondition);
}
