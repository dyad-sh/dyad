import { describe, expect, it } from "vitest";
import { AppDeletionQueue } from "./app_deletion_queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AppDeletionQueue", () => {
  it("serializes destructive admission to the global image collection", async () => {
    const queue = new AppDeletionQueue();
    const firstGate = deferred();
    const order: string[] = [];
    const first = queue.run(async () => {
      order.push("first:start");
      await firstGate.promise;
      order.push("first:end");
    });
    const second = queue.run(async () => {
      order.push("second:start");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("releases the next deletion after a failure", async () => {
    const queue = new AppDeletionQueue();
    const first = queue.run(async () => {
      throw new Error("admission failed");
    });
    const second = queue.run(async () => "deleted");

    await expect(first).rejects.toThrow("admission failed");
    await expect(second).resolves.toBe("deleted");
  });
});
