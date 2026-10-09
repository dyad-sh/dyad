import { beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { performance } from "node:perf_hooks";
import { sendTelemetryEvent } from "../utils/telemetry";
import { measureTestRunStep } from "./test_run_timing";
import {
  beginAppTestDeletion,
  isTestRunActive,
  withAppTestRun,
  stopAllAppTestRuns,
  drainAppTestRuns,
} from "./test_run_queue_service";
vi.mock("../utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: vi.fn(),
}));
vi.mock("../utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info: vi.fn(), error: vi.fn() }) },
}));
beforeEach(() => vi.clearAllMocks());

it("times queued cancellation separately and retains the active run through cleanup", async () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const options = {
    appId: 701,
    event: { sender: {} } as IpcMainInvokeEvent,
    source: "agent" as const,
  };
  const active = withAppTestRun(
    options,
    async (_run, timing) => {
      await measureTestRunStep(timing, "database_teardown", () => cleanup);
      return "done";
    },
    () => "cancelled",
  );
  await Promise.resolve();
  now = 10;
  const cancelledSignal = new AbortController();
  const executeQueued = vi.fn(async () => "unexpected");
  const queued = withAppTestRun(
    { ...options, externalSignal: cancelledSignal.signal },
    executeQueued,
    () => "cancelled",
  );
  try {
    now = 60;
    cancelledSignal.abort();
    expect(await queued).toBe("cancelled");
    expect(executeQueued).not.toHaveBeenCalled();
    const summaries = () =>
      vi
        .mocked(sendTelemetryEvent)
        .mock.calls.filter(([event]) => event === "e2e_test_run_completed")
        .map(([, properties]) => properties!);
    expect(summaries()).toEqual([
      expect.objectContaining({
        status: "cancelled",
        duration_ms: 50,
      }),
    ]);
    now = 100;
    finish();
    expect(await active).toBe("done");
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1]).toMatchObject({
      duration_ms: 100,
    });
    expect(summaries()[0].timing_id).not.toBe(summaries()[1].timing_id);
    expect(summaries()[1].run_steps).toContainEqual({
      step: "cleanup",
      duration_ms: 100,
    });
    expect(sendTelemetryEvent).toHaveBeenCalledTimes(2);
  } finally {
    finish();
    await Promise.allSettled([active, queued]);
    clock.mockRestore();
  }
});

it("fences new requests and settles queued requests before app deletion drains cleanup", async () => {
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const options = {
    appId: 501,
    event: { sender: {} } as IpcMainInvokeEvent,
    source: "agent" as const,
  };
  const first = withAppTestRun(
    options,
    async () => {
      await cleanup;
      return "done";
    },
    () => "cancelled",
  );
  const execute = vi.fn(async () => "unexpected");
  const second = withAppTestRun(options, execute, () => "cancelled");
  await Promise.resolve();
  const deletion = beginAppTestDeletion(options.appId);
  try {
    expect(await second).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    await expect(
      withAppTestRun(options, execute, () => "cancelled"),
    ).rejects.toThrow("being deleted");
    expect(isTestRunActive(options.appId)).toBe(true);
    const drained = vi.fn();
    const drain = deletion.drain().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, drain]);
    expect(isTestRunActive(options.appId)).toBe(false);
  } finally {
    finish();
    await Promise.allSettled([first, second, deletion.drain()]);
    deletion.release();
  }
});

it("stops active and queued runs across apps while retaining their cleanup", async () => {
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const signals: AbortSignal[] = [];
  const pending = [601, 602].map((appId) => {
    const options = {
      appId,
      event: { sender: {} } as IpcMainInvokeEvent,
      source: "panel" as const,
    };
    const active = withAppTestRun(
      options,
      async ({ signal }) => {
        signals.push(signal);
        await cleanup;
        return "done";
      },
      () => "cancelled",
    );
    const executeQueued = vi.fn(async () => "unexpected");
    const queued = withAppTestRun(options, executeQueued, () => "cancelled");
    return { appId, active, queued, executeQueued };
  });
  await Promise.resolve();
  stopAllAppTestRuns();
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  for (const run of pending) {
    expect(await run.queued).toBe("cancelled");
    expect(run.executeQueued).not.toHaveBeenCalled();
    expect(isTestRunActive(run.appId)).toBe(true);
  }
  const drained = vi.fn();
  const drain = Promise.all(
    pending.map(({ appId }) => drainAppTestRuns(appId)),
  ).then(drained);
  await Promise.resolve();
  expect(drained).not.toHaveBeenCalled();
  finish();
  await Promise.all([...pending.map(({ active }) => active), drain]);
  expect(pending.every(({ appId }) => !isTestRunActive(appId))).toBe(true);
});
