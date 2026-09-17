import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatScrollController } from "./controller";
import { transition } from "./transition";
import type { ChatScrollEvent, ChatScrollState } from "./state";

const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});

function setup() {
  const scroller = document.createElement("div");
  document.body.append(scroller);
  let height = 1000;
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 200 },
  });
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  const onFollowing = vi.fn();
  scroller.scrollTop = 800;
  scroller.scrollTo = vi.fn((options: ScrollToOptions) => {
    scroller.scrollTop = Math.min(height - 200, options.top ?? 0);
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
    grow: (value: number) => {
      height = value;
      controller.reconcile();
    },
  };
}

describe("chat follow controller", () => {
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
      expect(result).toEqual(states[expected[i][j]]);
      if (expected[i][j] === i) expect(result).toBe(state);
    }),
  );
});
