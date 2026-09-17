import type { ChatScrollEvent, ChatScrollState } from "./state";
import { transition } from "./transition";
import { CHAT_SCROLL_RESTORE_EVENT } from "./restore";

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
  observeTransition?: (
    event: ChatScrollEvent,
    result: ReturnType<typeof transition>,
  ) => void,
) {
  let state: ChatScrollState = { type: "following" };
  let frame: number | undefined;
  let disposed = false;
  let touchY: number | undefined;
  let draggingScrollbar = false;
  const position = () => ({
    top: scroller.scrollTop,
    height: scroller.scrollHeight,
    viewport: scroller.clientHeight,
  });
  let lastPosition = position();
  const atBottom = (tolerance = 4) =>
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
    tolerance;
  const send = (event: ChatScrollEvent) => {
    if (disposed) return;
    const result = transition(state, event);
    const next = result.state;
    const changed = next.type !== state.type;
    state = next;
    observeTransition?.(event, result);
    if (changed) onFollowingChange(next.type === "following");
  };
  const observeUserMovement = () => {
    const current = position();
    // Passive input can arrive after compositor scrolling, and a touch gesture
    // stays latched to an inner card even after that card reaches its boundary.
    // Also cover selection/middle-button autoscroll and platform-specific keys:
    // actual upward movement, not a growing bottom gap, signals reading intent.
    // Exclude clamping caused by shrinking content/expanding viewport.
    if (
      current.top < lastPosition.top - 1 &&
      current.height >= lastPosition.height &&
      current.viewport <= lastPosition.viewport
    )
      send({ type: "user-away" });
    const delta = current.top - lastPosition.top;
    lastPosition = current;
    return delta;
  };
  const reconcile = () => {
    if (disposed || state.type !== "following" || frame !== undefined) return;
    frame = frames.request(() => {
      frame = undefined;
      if (!disposed) observeUserMovement();
      if (disposed || state.type !== "following" || scroller.clientHeight === 0)
        return;
      // Immediate positioning cannot chase a moving target like native smooth
      // scrolling. Resize/virtualizer measurements schedule any further correction.
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      lastPosition = position();
    });
  };
  const follow = () => {
    lastPosition = position();
    send({ type: "follow" });
    reconcile();
  };
  const pause = () => send({ type: "user-away" });
  const pauseForUpwardInput = () => {
    if (scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop > 0)
      pause();
  };
  const onScroll = () => {
    const delta = observeUserMovement();
    const wasReading = state.type === "reading";
    if (!draggingScrollbar) {
      // A generous reattachment threshold only applies to downward movement;
      // small deliberate upward movements must not immediately reattach.
      const nearBottom = atBottom(delta > 0 ? 80 : 4);
      send({ type: "position", atBottom: nearBottom });
      if (wasReading && nearBottom) reconcile();
    }
  };
  const hasNestedScroller = (target: EventTarget | null) => {
    for (
      let element = target instanceof Element ? target : null;
      element && element !== scroller;
      element = element.parentElement
    ) {
      if (
        element instanceof HTMLElement &&
        element.scrollHeight > element.clientHeight &&
        /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY)
      )
        return true;
    }
    return false;
  };
  const nestedScrollerConsumes = (
    target: EventTarget | null,
    deltaY: number,
  ) => {
    // Tool output and code blocks scroll independently. Only a gesture that
    // chains out of their boundary expresses intent to move the chat itself.
    for (
      let element = target instanceof Element ? target : null;
      element && element !== scroller;
      element = element.parentElement
    ) {
      if (
        !(element instanceof HTMLElement) ||
        element.scrollHeight <= element.clientHeight
      )
        continue;
      const style = getComputedStyle(element);
      if (!/^(auto|scroll|overlay)$/.test(style.overflowY)) continue;
      if (
        style.overscrollBehaviorY === "contain" ||
        style.overscrollBehaviorY === "none"
      )
        return true;
      if (
        deltaY < 0
          ? element.scrollTop > 0
          : element.scrollTop + element.clientHeight < element.scrollHeight - 1
      )
        return true;
    }
    return false;
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) return;
    if (hasNestedScroller(event.target)) {
      observeUserMovement();
      return;
    }
    if (event.deltaY < 0) pauseForUpwardInput();
    else if (event.deltaY > 0 && atBottom(80)) follow();
  };
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y =
      event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    if (
      y !== undefined &&
      touchY !== undefined &&
      y > touchY &&
      !event.defaultPrevented
    ) {
      if (hasNestedScroller(event.target)) {
        observeUserMovement();
      } else pauseForUpwardInput();
    }
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
      event.target.closest("input, textarea, select, [contenteditable=true]")
    )
      return;
    // Buttons consume Space to activate, but PageUp/Home/ArrowUp still scroll
    // their ancestor. Those keys must pause follow even on a focused tool toggle.
    if (
      event.key === " " &&
      event.target instanceof Element &&
      event.target.closest("button")
    )
      return;
    if (
      nestedScrollerConsumes(
        event.target,
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
          (event.key === " " && event.shiftKey)
          ? -1
          : 1,
      )
    )
      return;
    if (
      ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
      (event.key === " " && event.shiftKey)
    )
      pauseForUpwardInput();
    else if (
      ["ArrowDown", "PageDown", "End", " "].includes(event.key) &&
      atBottom(80)
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
  const onRestore = (event: Event) => {
    const top = (event as CustomEvent<number>).detail;
    if (!Number.isFinite(top)) return;
    event.preventDefault();
    pause();
    scroller.scrollTo({ top, behavior: "instant" });
    lastPosition = position();
    if (atBottom() && top <= scroller.scrollTop + 4) follow();
    else send({ type: "position", atBottom: false });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("wheel", onWheel, { passive: true });
  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: true });
  scroller.addEventListener("keydown", onKeyDown);
  scroller.addEventListener("pointerdown", onPointerDown);
  scroller.addEventListener(CHAT_SCROLL_RESTORE_EVENT, onRestore);
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
      scroller.removeEventListener(CHAT_SCROLL_RESTORE_EVENT, onRestore);
      scroller.ownerDocument.removeEventListener("pointerup", onPointerUp);
      scroller.ownerDocument.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
