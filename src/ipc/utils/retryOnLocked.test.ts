import { expect, it, vi } from "vitest";
import { retryOnLocked } from "./retryOnLocked";

it("rejects a late successful operation after cancellation", async () => {
  const controller = new AbortController();
  const operation = vi.fn(async () => {
    controller.abort(new Error("Stopped"));
    return "stale";
  });
  await expect(
    retryOnLocked(operation, "test", { signal: controller.signal }),
  ).rejects.toThrow("Stopped");
  expect(operation).toHaveBeenCalledOnce();
});
