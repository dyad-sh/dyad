import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
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
  deletion.release();
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
