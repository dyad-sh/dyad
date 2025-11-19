import { describe, it, expect, beforeEach } from "vitest";
import { withLock } from "../ipc/utils/lock_utils";

describe("Lock Utils", () => {
  let executionOrder: string[] = [];

  beforeEach(() => {
    executionOrder = [];
  });

  it("should execute function with lock", async () => {
    const result = await withLock("test-lock", async () => {
      executionOrder.push("executed");
      return "success";
    });

    expect(result).toBe("success");
    expect(executionOrder).toEqual(["executed"]);
  });

  it("should prevent concurrent execution with same lock", async () => {
    const slowFunction = async () => {
      executionOrder.push("start");
      await new Promise((resolve) => setTimeout(resolve, 100));
      executionOrder.push("end");
      return "done";
    };

    const promises = [
      withLock("test-lock-2", slowFunction),
      withLock("test-lock-2", slowFunction),
    ];

    await Promise.all(promises);

    // Should execute sequentially, not in parallel
    expect(executionOrder).toEqual(["start", "end", "start", "end"]);
  });

  it("should allow concurrent execution with different locks", async () => {
    const fastFunction = async (id: string) => {
      executionOrder.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(`end-${id}`);
      return id;
    };

    const promises = [
      withLock("lock-a", () => fastFunction("a")),
      withLock("lock-b", () => fastFunction("b")),
    ];

    await Promise.all(promises);

    // Should start both before either finishes
    expect(executionOrder[0]).toMatch(/start-[ab]/);
    expect(executionOrder[1]).toMatch(/start-[ab]/);
  });

  it("should propagate errors", async () => {
    await expect(
      withLock("test-lock-error", async () => {
        throw new Error("Test error");
      })
    ).rejects.toThrow("Test error");
  });

  it("should release lock even if function throws", async () => {
    // First call throws
    await expect(
      withLock("test-lock-3", async () => {
        throw new Error("First call");
      })
    ).rejects.toThrow("First call");

    // Second call should work (lock was released)
    const result = await withLock("test-lock-3", async () => {
      return "success";
    });

    expect(result).toBe("success");
  });

  it("should handle async functions correctly", async () => {
    const asyncFunction = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "async result";
    };

    const result = await withLock("test-lock-async", asyncFunction);
    expect(result).toBe("async result");
  });
});
