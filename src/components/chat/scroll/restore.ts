export const CHAT_SCROLL_RESTORE_EVENT = "dyad:restore-chat-scroll";

/** The mounted controller mirrors its follow state onto its scroller so tab
 * presentation captures intent rather than re-deriving it from geometry, which
 * lags the controller by a frame while streamed content grows.
 */
export const CHAT_SCROLL_FOLLOWING_ATTRIBUTE = "data-chat-scroll-following";

/** Returns undefined when no controller is attached to the scroller. */
export function isChatScrollFollowing(
  scroller: HTMLElement,
): boolean | undefined {
  const following = scroller.getAttribute(CHAT_SCROLL_FOLLOWING_ATTRIBUTE);
  return following === null ? undefined : following === "true";
}

export interface ChatScrollRestorePosition {
  top: number;
  following: boolean;
}

/** Tab presentation restores either a reading offset or bottom-follow intent.
 * The mounted controller owns the write; the fallback covers an as-yet
 * unattached controller while ChatTabs retries restoration across render frames.
 * Returns whether a mounted controller handled the restore.
 */
export function restoreChatScrollPosition(
  scroller: HTMLElement,
  top: number,
  following = false,
): boolean {
  const unhandled = scroller.dispatchEvent(
    new CustomEvent(CHAT_SCROLL_RESTORE_EVENT, {
      detail: { top, following } satisfies ChatScrollRestorePosition,
      cancelable: true,
    }),
  );
  if (unhandled) scroller.scrollTop = following ? scroller.scrollHeight : top;
  return !unhandled;
}
