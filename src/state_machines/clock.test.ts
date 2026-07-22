import { describe, expect, it } from "vitest";
import { createFakeClock, createSequentialIdSource } from "./testing";

describe("state-machine clock and ID test facilities", () => {
  it("advances timers deterministically and supports cancellation", () => {
    const clock = createFakeClock(100);
    const calls: string[] = [];
    const cancelled = clock.schedule(() => calls.push("cancelled"), 5);
    clock.schedule(() => {
      calls.push("first");
      clock.schedule(() => calls.push("nested"), 0);
    }, 10);
    clock.schedule(() => calls.push("second"), 10);

    clock.cancel(cancelled);
    expect(clock.pendingTimerCount()).toBe(2);
    clock.advanceBy(10);

    expect(calls).toEqual(["first", "second", "nested"]);
    expect(clock.now()).toBe(110);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it("rejects backwards time and produces kind-prefixed sequential IDs", () => {
    const clock = createFakeClock();
    expect(() => clock.advanceBy(-1)).toThrow("cannot move backwards");

    const ids = createSequentialIdSource();
    expect(ids.next("attempt")).toBe("attempt:1");
    expect(ids.next("request")).toBe("request:2");
  });
});
