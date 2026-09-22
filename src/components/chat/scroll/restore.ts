export const CHAT_SCROLL_RESTORE_EVENT = "dyad:restore-chat-scroll";

/** Tab presentation restoration is explicit reading intent, not layout growth.
 * The mounted controller owns the write; the fallback covers an as-yet
 * unattached controller while ChatTabs retries restoration across render frames.
 */
export function restoreChatScrollPosition(scroller: HTMLElement, top: number) {
  const unhandled = scroller.dispatchEvent(
    new CustomEvent(CHAT_SCROLL_RESTORE_EVENT, {
      detail: top,
      cancelable: true,
    }),
  );
  if (unhandled) scroller.scrollTop = top;
}
