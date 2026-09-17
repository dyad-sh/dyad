import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import {
  beginAppTestDeletion,
  isTestRunActive,
  withAppTestRun,
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
