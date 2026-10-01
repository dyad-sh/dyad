export const CHAT_SCROLL_RESTORE_EVENT = "dyad:restore-chat-scroll";

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
