import { describe, expect, it, vi } from "vitest";

import { TypeScriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

describe("TypeScriptUtilityProcessScheduler", () => {
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
});
