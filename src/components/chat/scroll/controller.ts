import type { ChatScrollEvent, ChatScrollState } from "./state";
import { transition } from "./transition";

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

/** Owns scroll writes for one real scroller. No other machine dependencies.
 * Layout notifications are coalesced; user intent is applied synchronously.
 * Frame scheduling is injected (not a wall-clock timer or operation ID source).
 */
export function createChatScrollController(
  scroller: HTMLElement,
  onFollowingChange: (following: boolean) => void,
  frames: FrameScheduler,
) {
  let state: ChatScrollState = { type: "following" };
  let frame: number | undefined;
  let disposed = false;
  let touchY: number | undefined;
  let draggingScrollbar = false;
  const atBottom = () =>
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 4;
  const send = (event: ChatScrollEvent) => {
    if (disposed) return;
    const next = transition(state, event);
    if (next.type !== state.type) onFollowingChange(next.type === "following");
    state = next;
  };
  const reconcile = () => {
    if (disposed || state.type !== "following" || frame !== undefined) return;
    frame = frames.request(() => {
      frame = undefined;
      if (disposed || state.type !== "following" || scroller.clientHeight === 0)
        return;
      // Immediate positioning cannot chase a moving target like native smooth
      // scrolling. Resize/virtualizer measurements schedule any further correction.
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    });
  };
  const follow = () => {
    send({ type: "follow" });
    reconcile();
  };
  const pause = () => send({ type: "user-away" });
  const onScroll = () => {
    if (!draggingScrollbar) send({ type: "position", atBottom: atBottom() });
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // Trackpad pinch/zoom is not scroll-away intent.
    if (event.deltaY < 0) pause();
    else if (event.deltaY > 0 && atBottom()) follow();
  };
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y !== undefined && touchY !== undefined && y > touchY) pause();
    touchY = y;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        "input, textarea, select, button, [contenteditable=true]",
      )
    )
      return;
    if (
      ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
      (event.key === " " && event.shiftKey)
    )
      pause();
    else if (
      ["ArrowDown", "PageDown", "End", " "].includes(event.key) &&
      atBottom()
    )
      follow();
  };
  const onPointerDown = (event: PointerEvent) => {
    // Only the scrollbar gutter; selecting/clicking message content must not
    // silently disable follow mode. Both left and right scrollbars are supported.
    const rect = scroller.getBoundingClientRect();
    const contentLeft = rect.left + scroller.clientLeft;
    if (
      event.clientX < contentLeft ||
      event.clientX >= contentLeft + scroller.clientWidth
    ) {
      draggingScrollbar = true;
      pause();
    }
  };
  const onPointerUp = () => {
    if (!draggingScrollbar) return;
    draggingScrollbar = false;
    if (atBottom()) follow();
    else onScroll();
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("wheel", onWheel, { passive: true });
  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: true });
  scroller.addEventListener("keydown", onKeyDown);
  scroller.addEventListener("pointerdown", onPointerDown);
  scroller.ownerDocument.addEventListener("pointerup", onPointerUp);
  scroller.ownerDocument.addEventListener("pointercancel", onPointerUp);
  onFollowingChange(true);
  reconcile();
  return {
    follow,
    reconcile,
    dispose() {
      disposed = true;
      if (frame !== undefined) frames.cancel(frame);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("keydown", onKeyDown);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.ownerDocument.removeEventListener("pointerup", onPointerUp);
      scroller.ownerDocument.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
