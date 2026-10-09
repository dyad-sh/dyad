import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatScrollController } from "./controller";
import { transition } from "./transition";
import type { ChatScrollEvent, ChatScrollState } from "./state";
import { isChatScrollFollowing, restoreChatScrollPosition } from "./restore";

const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});

function setup() {
  const scroller = document.createElement("div");
  document.body.append(scroller);
  let height = 1000;
  let viewport = 200;
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => viewport },
    clientWidth: { value: 100 },
  });
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  const onFollowing = vi.fn();
  scroller.scrollTop = 800;
  scroller.scrollTo = vi.fn((options: ScrollToOptions) => {
    scroller.scrollTop = Math.max(
      0,
      Math.min(height - viewport, options.top ?? 0),
    );
  }) as typeof scroller.scrollTo;
  const controller = createChatScrollController(scroller, onFollowing, {
    request(callback) {
      callbacks.set(++nextId, callback);
      return nextId;
    },
    cancel(id) {
      callbacks.delete(id);
    },
  });
  disposals.push(controller.dispose);
  const flush = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback());
  };
  const position = (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  };
  return {
    scroller,
    controller,
    callbacks,
    onFollowing,
    flush,
    position,
    resize: (value: number) => {
      viewport = value;
      controller.reconcile();
    },
    grow: (value: number) => {
      height = value;
      controller.reconcile();
    },
  };
}

describe("chat follow controller", () => {
  it("mirrors follow intent onto the scroller even when growth has not been applied yet", () => {
    const h = setup();
    h.flush();
    h.grow(4000); // Streamed growth lands before the follow frame runs.
    expect(
      h.scroller.scrollHeight - h.scroller.clientHeight - h.scroller.scrollTop,
    ).toBeGreaterThan(4);
    expect(isChatScrollFollowing(h.scroller)).toBe(true);
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
    h.position(600);
    expect(isChatScrollFollowing(h.scroller)).toBe(false);
    h.controller.dispose();
    expect(isChatScrollFollowing(h.scroller)).toBeUndefined();
  });

  it("coalesces growth and follows the latest measurement, not a captured height", () => {
    const h = setup();
    h.grow(4000);
    h.position(800); // Size changes can produce a non-bottom scroll event.
    h.grow(8000);
    expect(h.callbacks.size).toBe(1);
    h.flush();
    expect(h.scroller.scrollTop).toBe(7800);
    expect(h.onFollowing.mock.calls).toEqual([[true]]);
    h.grow(600); // Collapsing a card must not detach either.
    h.flush();
    expect(h.scroller.scrollTop).toBe(400);
  });

  it("does not let a queued programmatic event undo wheel intent; returning to bottom resumes", () => {
    const h = setup();
    h.flush();
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
    h.position(800); // Our last scroll notification races the native wheel.
    h.position(600);
    h.grow(3000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(600);
    h.position(2800); // User scrolls back down without pressing the button.
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(3800);
    expect(h.onFollowing.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("pauses pending work immediately on keyboard intent and explicitly reattaches", () => {
    const h = setup();
    h.grow(3000);
    h.scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    h.flush();
    expect(h.scroller.scrollTop).toBe(800);
    h.controller.follow();
    h.flush();
    expect(h.scroller.scrollTop).toBe(2800);
  });

  it("does not detach a short chat on ineffective wheel-up, then follows its growth", () => {
    const h = setup();
    h.grow(200);
    h.flush();
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    h.grow(3000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(2800);
    expect(h.onFollowing.mock.calls).toEqual([[true]]);
  });

  it("recognizes unenumerated upward scrolling but not layout clamping", () => {
    const h = setup();
    h.flush();
    h.scroller.dispatchEvent(new MouseEvent("pointerdown", { clientX: 50 }));
    h.position(700); // Selection autoscroll has a held pointer, not wheel/key.
    document.dispatchEvent(new Event("pointerup"));
    h.grow(2000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(700);
    h.controller.follow();
    h.flush();
    h.grow(600);
    h.position(400); // Native clamping after content shrink is not user intent.
    h.flush();
    h.grow(1000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(800);
  });

  it("resumes within 80px on downward movement without undoing a small upward gesture", () => {
    const h = setup();
    h.flush();
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -20 }));
    h.position(780);
    expect(h.onFollowing).toHaveBeenLastCalledWith(false);
    h.position(600);
    h.position(740); // 60px short of bottom: deliberate downward return.
    h.flush();
    expect(h.scroller.scrollTop).toBe(800);
    expect(h.onFollowing).toHaveBeenLastCalledWith(true);
  });

  it("reattaches on viewport resize without a scroll event", () => {
    const h = setup();
    h.flush();
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
    h.position(600);
    h.resize(400); // Same scrollTop is now bottom-aligned.
    h.flush();
    expect(h.onFollowing).toHaveBeenLastCalledWith(true);
    h.grow(2000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(1600);
  });

  it("ignores virtualizer upward corrections while total content grows", () => {
    const h = setup();
    h.flush();
    h.grow(1200);
    h.position(760); // A measured item above shrinks while the last item grows.
    h.flush();
    expect(h.scroller.scrollTop).toBe(1000);
    expect(h.onFollowing.mock.calls).toEqual([[true]]);
  });

  it("does not treat editing a message input as scroll intent", () => {
    const h = setup();
    const input = document.createElement("textarea");
    h.scroller.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    h.grow(3000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(2800);
  });

  it("honors PageUp on a focused message button but ignores Space activation", () => {
    const h = setup();
    const button = document.createElement("button");
    h.scroller.append(button);
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    h.grow(3000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(2800);
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
    );
    h.position(2400);
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(2400);
  });

  it("restores bottom intent even when remeasurement changes the old pixel offset", () => {
    const h = setup();
    restoreChatScrollPosition(h.scroller, 300, true);
    h.flush();
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(3800);
    expect(h.onFollowing).toHaveBeenLastCalledWith(true);
  });

  it("preserves a restored top-of-history position before virtualized content is measured", () => {
    const h = setup();
    h.grow(200); // Initially, the virtualizer's measurement row fits the viewport.
    // Tab restoration can retry while the list still has no measured height.
    for (let frame = 0; frame < 4; frame++) {
      restoreChatScrollPosition(h.scroller, 0, false);
      h.controller.reconcile();
      h.flush();
    }
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(0);
    expect(isChatScrollFollowing(h.scroller)).toBe(false);

    h.position(3800); // Reaching the real bottom still resumes following.
    h.grow(5000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(4800);
    expect(isChatScrollFollowing(h.scroller)).toBe(true);
  });

  it("preserves an explicitly restored tab position across queued frames and later growth", () => {
    const h = setup();
    restoreChatScrollPosition(h.scroller, 300);
    h.flush();
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(300);
    expect(h.onFollowing).toHaveBeenLastCalledWith(false);
    restoreChatScrollPosition(h.scroller, 3800);
    h.grow(5000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(4800);
    h.controller.dispose();
    restoreChatScrollPosition(h.scroller, 400);
    expect(h.scroller.scrollTop).toBe(400);
  });

  it("keeps following when a tool card consumes the wheel, but pauses at its chaining boundary", () => {
    const h = setup();
    const inner = document.createElement("div");
    inner.style.overflowY = "auto";
    Object.defineProperties(inner, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 150 },
    });
    h.scroller.append(inner);
    inner.scrollTop = 300;
    inner.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
    );
    h.grow(3000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(2800);
    expect(h.onFollowing.mock.calls).toEqual([[true]]);

    inner.scrollTop = 0;
    inner.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
    );
    // A passive listener may see the inner card AFTER it has reached zero,
    // even though the gesture was entirely consumed inside it.
    h.grow(4000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(3800);
    expect(h.onFollowing.mock.calls).toEqual([[true]]);

    inner.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
    );
    h.position(3700); // The next gesture actually chains to the chat.
    h.grow(5000);
    h.flush();
    expect(h.scroller.scrollTop).toBe(3700);
    expect(h.onFollowing.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps a Home press at the top when the virtualizer re-anchors after measuring", () => {
    const h = setup();
    h.grow(4000);
    h.flush();
    h.scroller.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    h.position(0); // The browser performs the jump itself.
    expect(isChatScrollFollowing(h.scroller)).toBe(false);
    h.position(600); // Newly rendered rows measured taller than estimated.
    expect(h.scroller.scrollTop).toBe(0);
    expect(isChatScrollFollowing(h.scroller)).toBe(false);

    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 200 }));
    h.position(300); // The reader leaving the top is not a correction.
    expect(h.scroller.scrollTop).toBe(300);
  });

  it("cancels frames and rejects late callbacks after chat teardown", () => {
    const h = setup();
    const lateCallback = [...h.callbacks.values()][0];
    h.controller.dispose();
    expect(h.callbacks.size).toBe(0);
    h.grow(5000);
    lateCallback();
    h.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    expect(h.scroller.scrollTo).not.toHaveBeenCalled();
    expect(h.onFollowing.mock.calls).toEqual([[true]]);
  });
});

it("covers the complete follow-intent transition matrix, preserving no-op identity", () => {
  const states: ChatScrollState[] = [
    { type: "following" },
    { type: "reading", hasLeftBottom: false },
    { type: "reading", hasLeftBottom: true },
  ];
  const events: ChatScrollEvent[] = [
    { type: "follow" },
    { type: "user-away" },
    { type: "position", atBottom: true },
    { type: "position", atBottom: false },
  ];
  const expected = [
    [0, 1, 0, 0],
    [0, 1, 1, 2],
    [0, 2, 0, 2],
  ];
  states.forEach((state, i) =>
    events.forEach((event, j) => {
      const result = transition(state, event);
      expect(result.state).toEqual(states[expected[i][j]]);
      if (expected[i][j] === i) {
        expect(result.state).toBe(state);
        expect(result.kind).toBe("ignored");
        if (result.kind === "ignored") expect(result.reason).not.toBe("");
      }
    }),
  );
});
