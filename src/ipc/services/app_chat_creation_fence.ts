import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const creationBlockCounts = new Map<number, number>();

export function beginAppChatMutation(appId: number): () => void {
  creationBlockCounts.set(appId, (creationBlockCounts.get(appId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (creationBlockCounts.get(appId) ?? 1) - 1;
    if (next === 0) {
      creationBlockCounts.delete(appId);
    } else {
      creationBlockCounts.set(appId, next);
    }
  };
}

export const beginAppChatDeletion = beginAppChatMutation;

export function assertAppChatCreationOpen(appId: number): void {
  if (!creationBlockCounts.has(appId)) return;
  throw new DyadError(
    "App is temporarily unavailable",
    DyadErrorKind.Precondition,
  );
}
