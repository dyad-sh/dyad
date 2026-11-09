// Safe to import in both the main and renderer processes.

/** Branches of chat worktrees start with this (`dyad/chat-<id>[-n]`). */
export const WORKTREE_BRANCH_PREFIX = "dyad/chat-";

/** Where a commit came from, read from the `Dyad-*` trailers chats write. */
export interface DyadCommitOrigin {
  /** Chat whose turn or squashed work produced the commit. */
  chatId: number | null;
  /** Worktree branch it came from (`dyad/chat-<id>`), when it came from one. */
  workspaceBranch: string | null;
  /** Assistant messages whose turns the commit contains. */
  turnMessageIds: number[];
}

/**
 * Reads the trailers on commits from isolated chat worktrees: each turn's
 * checkpoint carries `Dyad-Chat`, `Dyad-Turn`, and `Dyad-Workspace`; the one
 * squash commit that lands a worktree's work on the app's branch carries the
 * chat, the worktree, and a `Dyad-Turn` for every turn it includes.
 */
export function parseDyadCommitTrailers(message: string): DyadCommitOrigin {
  const chat = /^Dyad-Chat: (\d+)\s*$/m.exec(message);
  const workspace = /^Dyad-Workspace: (\S+)\s*$/m.exec(message);
  const turnMessageIds = [...message.matchAll(/^Dyad-Turn: (\d+)\s*$/gm)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return {
    chatId: chat ? Number.parseInt(chat[1], 10) : null,
    workspaceBranch: workspace ? workspace[1] : null,
    turnMessageIds,
  };
}
