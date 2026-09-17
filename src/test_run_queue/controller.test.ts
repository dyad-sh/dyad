import { describe, expect, it, vi } from "vitest";
import { TestRunQueue } from "./controller";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createQueue() {
  return new TestRunQueue({ onChange: vi.fn(), onError: vi.fn() });
}
const request = (runId: number) => ({
  runId,
  source: "agent" as const,
  testFile: `e2e-tests/${runId}.spec.ts`,
});

describe("test run queue", () => {
  it("executes FIFO and holds the slot through cleanup and result accounting", async () => {
    const queue = createQueue();
    const cleanup = gate();
    const accounting = gate();
    const calls: string[] = [];
    let activeSignal: AbortSignal | undefined;
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async ({ signal }) => {
        activeSignal = signal;
        calls.push("run 1");
        await cleanup.promise;
        calls.push("cleanup 1");
        await accounting.promise;
        calls.push("result 1");
        return "first";
      },
    });
    const second = queue.enqueue({
      request: request(2),
      cancelled: () => "cancelled",
      execute: async () => {
        calls.push("run 2");
        return "second";
      },
    });
    const third = queue.enqueue({
      request: request(3),
      cancelled: () => "cancelled",
      execute: async () => {
        calls.push("run 3");
        return "third";
      },
    });
    await Promise.resolve();
    expect(calls).toEqual(["run 1"]);
    expect(activeSignal?.aborted).toBe(false);
    expect(queue.getSnapshot().queuedRuns.map((run) => run.runId)).toEqual([
      2, 3,
    ]);
    cleanup.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["run 1", "cleanup 1"]);
    accounting.resolve();
    expect(await Promise.all([first, second, third])).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(calls).toEqual(["run 1", "cleanup 1", "result 1", "run 2", "run 3"]);
    expect(queue.getSnapshot()).toEqual({ activeRun: null, queuedRuns: [] });
  });

  it("settles a cancelled middle request immediately without skipping the active cleanup", async () => {
    const queue = createQueue();
    const cleanup = gate();
    const abort = new AbortController();
    const execute = vi.fn(async () => "unexpected");
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        await cleanup.promise;
        return "first";
      },
    });
    const second = queue.enqueue({
      request: request(2),
      signal: abort.signal,
      cancelled: () => "cancelled",
      execute,
    });
    const third = queue.enqueue({
      request: request(3),
      cancelled: () => "cancelled",
      execute: async () => "third",
    });
    abort.abort();
    expect(await second).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    expect(queue.getSnapshot().activeRun?.runId).toBe(1);
    expect(queue.getSnapshot().queuedRuns.map((run) => run.runId)).toEqual([3]);
    cleanup.resolve();
    expect(await Promise.all([first, third])).toEqual(["first", "third"]);
  });

  it("stops all admitted requests but waits for the active request's cleanup before draining", async () => {
    const queue = createQueue();
    const cleanup = gate();
    let signal: AbortSignal | undefined;
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async (run) => {
        signal = run.signal;
        await cleanup.promise;
        return "first";
      },
    });
    const execute = vi.fn(async () => "second");
    const second = queue.enqueue({
      request: request(2),
      cancelled: () => "cancelled",
      execute,
    });
    await Promise.resolve();
    queue.stop();
    expect(signal?.aborted).toBe(true);
    expect(await second).toBe("cancelled");
    const drained = vi.fn();
    const drain = queue.drain().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    cleanup.resolve();
    await Promise.all([first, drain]);
    expect(drained).toHaveBeenCalledOnce();
  });

  it("continues after an execution throws", async () => {
    const queue = createQueue();
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        throw new Error("setup failed");
      },
    });
    const second = queue.enqueue({
      request: request(2),
      cancelled: () => "cancelled",
      execute: async () => "second",
    });
    await expect(first).rejects.toThrow("setup failed");
    expect(await second).toBe("second");
  });

  it("keeps separate app queues independent", async () => {
    const firstQueue = createQueue();
    const secondQueue = createQueue();
    const cleanup = gate();
    const first = firstQueue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        await cleanup.promise;
        return "first";
      },
    });
    expect(
      await secondQueue.enqueue({
        request: request(1),
        cancelled: () => "cancelled",
        execute: async () => "second",
      }),
    ).toBe("second");
    expect(firstQueue.getSnapshot().activeRun?.runId).toBe(1);
    cleanup.resolve();
    await first;
  });

  it("rejects an execution handle from another app even when their run IDs match", async () => {
    const firstQueue = createQueue();
    const secondQueue = createQueue();
    const cleanup = gate();
    const first = firstQueue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async (run) => {
        expect(firstQueue.ownsExecution(run)).toBe(true);
        expect(secondQueue.ownsExecution(run)).toBe(false);
        await cleanup.promise;
        return "first";
      },
    });
    const second = secondQueue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        await cleanup.promise;
        return "second";
      },
    });
    await Promise.resolve();
    cleanup.resolve();
    await Promise.all([first, second]);
  });

  it("updates a queued caller's position as earlier requests are cancelled", async () => {
    const queue = createQueue();
    const cleanup = gate();
    const abort = new AbortController();
    const onQueued = vi.fn();
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        await cleanup.promise;
        return "first";
      },
    });
    const second = queue.enqueue({
      request: request(2),
      signal: abort.signal,
      cancelled: () => "cancelled",
      execute: async () => "second",
    });
    const third = queue.enqueue({
      request: request(3),
      onQueued,
      cancelled: () => "cancelled",
      execute: async () => "third",
    });
    expect(onQueued).toHaveBeenLastCalledWith(2);
    abort.abort();
    expect(onQueued).toHaveBeenLastCalledWith(1);
    cleanup.resolve();
    await Promise.all([first, second, third]);
  });

  it("honors cancellation reentered from admission publication before execution", async () => {
    const abort = new AbortController();
    const queue = new TestRunQueue({
      onChange: () => abort.abort(),
      onError: vi.fn(),
    });
    const execute = vi.fn(async () => "unexpected");
    expect(
      await queue.enqueue({
        request: request(1),
        signal: abort.signal,
        execute,
        cancelled: () => "cancelled",
      }),
    ).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a failed cancellation callback without stranding the remaining queue", async () => {
    const queue = createQueue();
    const cleanup = gate();
    const abort = new AbortController();
    const first = queue.enqueue({
      request: request(1),
      cancelled: () => "cancelled",
      execute: async () => {
        await cleanup.promise;
        return "first";
      },
    });
    const second = queue.enqueue({
      request: request(2),
      signal: abort.signal,
      cancelled: () => {
        throw new Error("delivery failed");
      },
      execute: async () => "second",
    });
    abort.abort();
    await expect(second).rejects.toThrow("delivery failed");
    cleanup.resolve();
    await first;
    expect(queue.getSnapshot().activeRun).toBeNull();
  });
});
