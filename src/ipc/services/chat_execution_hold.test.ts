import { describe, expect, it, vi } from "vitest";
import { ChatExecutionHold } from "./chat_execution_hold";

describe("ChatExecutionHold", () => {
  it("keeps overlapping holds app-scoped and releases each hold only once", () => {
    const holds = new ChatExecutionHold();
    const listener = vi.fn();
    const otherApp = vi.fn();
    const unsubscribe = holds.subscribe(1, listener);
    holds.subscribe(2, otherApp);
    const releaseFirst = holds.acquire(1);
    const releaseSecond = holds.acquire(1);
    releaseFirst();
    releaseFirst();
    expect(holds.isHeld(1)).toBe(true);
    expect(holds.isHeld(2)).toBe(false);
    expect(listener.mock.calls).toEqual([[true]]);
    releaseSecond();
    expect(holds.isHeld(1)).toBe(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    expect(otherApp).not.toHaveBeenCalled();
    const releaseOtherApp = holds.acquire(2);
    expect(holds.isHeld(2)).toBe(true);
    releaseOtherApp();
    expect(holds.isHeld(2)).toBe(false);
    expect(otherApp.mock.calls).toEqual([[true], [false]]);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    unsubscribe();
    holds.acquire(1)();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
