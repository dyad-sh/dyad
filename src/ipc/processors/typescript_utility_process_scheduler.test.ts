import { afterEach, describe, expect, it, vi } from "vitest";

import { TypeScriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

describe("TypeScriptUtilityProcessScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs operations globally in FIFO order", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const events: string[] = [];
    let finishFirst!: () => void;

    const first = scheduler.runExclusive("code-explorer", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push("first:end");
      return 1;
    });
    const second = scheduler.runExclusive("tsc", async () => {
      events.push("second:start");
      return 2;
    });

    expect(events).toEqual(["first:start"]);
    finishFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("reuses an idle explorer for another explorer request", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const stop = vi.fn(async () => undefined);
    const token = {};

    await scheduler.runExclusive("code-explorer", async () => {
      scheduler.registerResidentProcess({
        kind: "code-explorer",
        reusable: true,
        token,
        stop,
      });
    });
    await scheduler.runExclusive("code-explorer", async () => undefined);

    expect(stop).not.toHaveBeenCalled();
  });

  it("stops an idle explorer before starting TSC", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const events: string[] = [];
    const token = {};
    let registration: ReturnType<typeof scheduler.registerResidentProcess>;

    await scheduler.runExclusive("code-explorer", async () => {
      registration = scheduler.registerResidentProcess({
        kind: "code-explorer",
        reusable: true,
        token,
        stop: async () => {
          events.push("explorer:stop");
          registration.clear();
        },
      });
    });
    await scheduler.runExclusive("tsc", async () => {
      events.push("tsc:start");
    });

    expect(events).toEqual(["explorer:stop", "tsc:start"]);
  });

  it("waits for an already-stopping explorer before reusing its kind", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const events: string[] = [];
    const token = {};
    let finishStop!: () => void;
    let registration: ReturnType<typeof scheduler.registerResidentProcess>;

    await scheduler.runExclusive("code-explorer", async () => {
      registration = scheduler.registerResidentProcess({
        kind: "code-explorer",
        reusable: true,
        token,
        stop: async () => {
          events.push("explorer:stopping");
          await new Promise<void>((resolve) => {
            finishStop = resolve;
          });
          registration.clear();
          events.push("explorer:stopped");
        },
      });
    });

    const stopping = registration!.stop();
    const next = scheduler.runExclusive("code-explorer", async () => {
      events.push("explorer:next");
    });
    await Promise.resolve();
    expect(events).toEqual(["explorer:stopping"]);

    finishStop();
    await Promise.all([stopping, next]);
    expect(events).toEqual([
      "explorer:stopping",
      "explorer:stopped",
      "explorer:next",
    ]);
  });

  it("stops a non-reusable TSC process before the next TSC run", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const events: string[] = [];
    let registration: ReturnType<typeof scheduler.registerResidentProcess>;

    await scheduler.runExclusive("tsc", async () => {
      registration = scheduler.registerResidentProcess({
        kind: "tsc",
        reusable: false,
        token: {},
        stop: async () => {
          events.push("first:stop");
          registration.clear();
        },
      });
    });
    await scheduler.runExclusive("tsc", async () => {
      events.push("second:start");
    });

    expect(events).toEqual(["first:stop", "second:start"]);
  });

  it("continues the queue after an operation rejects", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    const first = scheduler.runExclusive("tsc", async () => {
      throw new Error("boom");
    });
    const second = scheduler.runExclusive("code-explorer", async () => 2);

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe(2);
  });

  it("retries stopping a resident after a stop attempt rejects", async () => {
    const scheduler = new TypeScriptUtilityProcessScheduler();
    let stopAttempts = 0;
    let registration: ReturnType<typeof scheduler.registerResidentProcess>;

    await scheduler.runExclusive("code-explorer", async () => {
      registration = scheduler.registerResidentProcess({
        kind: "code-explorer",
        reusable: true,
        token: {},
        stop: async () => {
          stopAttempts++;
          if (stopAttempts === 1) {
            throw new Error("temporary stop failure");
          }
          registration.clear();
        },
      });
    });

    const firstOperation = vi.fn(async () => undefined);
    await expect(scheduler.runExclusive("tsc", firstOperation)).rejects.toThrow(
      "temporary stop failure",
    );
    expect(firstOperation).not.toHaveBeenCalled();

    const secondOperation = vi.fn(async () => undefined);
    await expect(
      scheduler.runExclusive("tsc", secondOperation),
    ).resolves.toBeUndefined();
    expect(stopAttempts).toBe(2);
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it("times out a hung stop without starting the incompatible operation", async () => {
    vi.useFakeTimers();
    const scheduler = new TypeScriptUtilityProcessScheduler();
    let registration: ReturnType<typeof scheduler.registerResidentProcess>;

    await scheduler.runExclusive("code-explorer", async () => {
      registration = scheduler.registerResidentProcess({
        kind: "code-explorer",
        reusable: true,
        token: {},
        stop: () => new Promise<void>(() => undefined),
      });
    });

    const blockedOperation = vi.fn(async () => undefined);
    const blocked = scheduler.runExclusive("tsc", blockedOperation);
    const expectation = expect(blocked).rejects.toThrow(
      "Timed out after 30000ms waiting for code-explorer process to exit",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
    expect(blockedOperation).not.toHaveBeenCalled();

    // A later real exit clears the resident and lets the queue recover.
    registration!.clear();
    await expect(
      scheduler.runExclusive("tsc", async () => "recovered"),
    ).resolves.toBe("recovered");
  });
});
