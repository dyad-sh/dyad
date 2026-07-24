import { describe, expect, it, vi } from "vitest";
import type { Clock, ClockHandle } from "./clock";
import { createFakeClock } from "./testing";
import { TimerLeaseScope } from "./timer_lease";

describe("TimerLeaseScope", () => {
  it("replaces self-reentry leases and emits the owning token once", () => {
    const clock = createFakeClock();
    const events: string[] = [];
    const leases = new TimerLeaseScope<string, string, string>(clock);

    leases.replace(
      "watchdog",
      "operation-1",
      10,
      (token) => token,
      (event) => events.push(event),
    );
    leases.replace(
      "watchdog",
      "operation-2",
      20,
      (token) => token,
      (event) => events.push(event),
    );
    clock.advanceBy(10);
    expect(events).toEqual([]);
    expect(leases.has("watchdog", "operation-2")).toBe(true);

    clock.advanceBy(10);
    expect(events).toEqual(["operation-2"]);
    expect(leases.has("watchdog")).toBe(false);
  });

  it("cancels on exit and disposes every owned lease idempotently", () => {
    const clock = createFakeClock();
    const events: string[] = [];
    const leases = new TimerLeaseScope<string, string, string>(clock);
    const emit = (event: string) => events.push(event);
    leases.replace("a", "a:1", 10, (token) => token, emit);
    leases.replace("b", "b:1", 10, (token) => token, emit);
    leases.remove("a");
    leases.dispose();
    leases.dispose();
    leases.replace("c", "c:1", 10, (token) => token, emit);

    clock.advanceBy(10);
    expect(events).toEqual([]);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it("captures the event sink for each lease", () => {
    const clock = createFakeClock();
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const leases = new TimerLeaseScope<string, string, string>(clock);

    leases.replace(
      "first",
      "first:1",
      10,
      (token) => token,
      (event) => firstEvents.push(event),
    );
    leases.replace(
      "second",
      "second:1",
      10,
      (token) => token,
      (event) => secondEvents.push(event),
    );
    clock.advanceBy(10);

    expect(firstEvents).toEqual(["first:1"]);
    expect(secondEvents).toEqual(["second:1"]);
  });

  it("does not acquire a timer after disposal", () => {
    const handle = {} as ClockHandle;
    const clock: Clock = {
      now: vi.fn(() => 0),
      schedule: vi.fn(() => handle),
      cancel: vi.fn(),
    };
    const leases = new TimerLeaseScope<string, string, string>(clock);
    leases.dispose();

    leases.replace("late", "late:1", 10, (token) => token, vi.fn());

    expect(clock.schedule).not.toHaveBeenCalled();
    expect(clock.cancel).not.toHaveBeenCalled();
  });
});
