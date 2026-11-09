import type { Version } from "@/ipc/types";

/**
 * Index of the version on the app's branch that holds a message's turn, or
 * -1. A chat in the app's folder commits each turn there; a chat in a worktree
 * lands its work as one squash whose `Dyad-Turn` trailers name its turns, so
 * its messages' own commit hashes are not on the branch.
 */
export function findVersionIndexForMessage(
  versions: readonly Version[],
  message: { id: number; commitHash?: string | null },
): number {
  if (message.commitHash) {
    const byCommit = versions.findIndex(
      (version) => version.oid === message.commitHash,
    );
    if (byCommit >= 0) return byCommit;
  }
  return versions.findIndex(
    (version) => version.turnMessageIds?.includes(message.id) ?? false,
  );
}

/**
 * Whether a version also holds turns other than this message's: a worktree's
 * squash can land several turns at once, so restoring to before it would
 * undo those turns too.
 */
export function versionHoldsOtherTurns(
  version: Version,
  messageId: number,
): boolean {
  return (version.turnMessageIds ?? []).some((id) => id !== messageId);
}
