import { describe, expect, it } from "vitest";
import { createFakeClock } from "./testing";
import { TimerLeaseScope } from "./timer_lease";

describe("TimerLeaseScope", () => {
  it("replaces self-reentry leases and emits the owning token once", () => {
    const clock = createFakeClock();
    const events: string[] = [];
    const leases = new TimerLeaseScope<string, string, string>(clock, (event) =>
      events.push(event),
    );

    leases.replace("watchdog", "operation-1", 10, (token) => token);
    leases.replace("watchdog", "operation-2", 20, (token) => token);
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
    const leases = new TimerLeaseScope<string, string, string>(clock, (event) =>
      events.push(event),
    );
    leases.replace("a", "a:1", 10, (token) => token);
    leases.replace("b", "b:1", 10, (token) => token);
    leases.remove("a");
    leases.dispose();
    leases.dispose();
    leases.replace("c", "c:1", 10, (token) => token);

    clock.advanceBy(10);
    expect(events).toEqual([]);
    expect(clock.pendingTimerCount()).toBe(0);
  });
});
