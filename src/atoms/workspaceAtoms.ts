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
