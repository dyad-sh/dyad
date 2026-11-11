import { atom } from "jotai";

/**
 * Apps whose "another chat is working" banner the user dismissed, by app id.
 *
 * In-memory rather than in settings: dismissing means "not now". The banner
 * returns next launch while worktree isolation is still off, because the
 * concurrent-edit risk it describes is still there.
 */
export const dismissedConcurrentChatBannerAppIdsAtom = atom<
  ReadonlySet<number>
>(new Set<number>());

/**
 * Apps whose "npm worktrees use a lot of disk space" banner the user
 * dismissed. In-memory for the same reason: the cost it describes remains
 * while the app installs with npm.
 */
export const dismissedNpmWorktreeBannerAppIdsAtom = atom<ReadonlySet<number>>(
  new Set<number>(),
);

/** Dismiss the CLI upgrade nudge for this version across chats until relaunch. */
export const dismissedClaudeWorktreeBannerVersionsAtom = atom<
  ReadonlySet<string>
>(new Set<string>());
