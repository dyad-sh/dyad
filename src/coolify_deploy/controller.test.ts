import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { CoolifyDeployRegistry, type RunDeployPipeline } from "./controller";
import type { CoolifyDeployState } from "./state";

/** A pipeline that never settles until the test releases it. */
function pendingPipeline() {
  let release!: (value: { url: string | null }) => void;
  let signal!: AbortSignal;
  const run = vi.fn(async (args: Parameters<RunDeployPipeline>[0]) => {
    signal = args.signal;
    return new Promise<{ url: string | null }>((resolve, reject) => {
      release = resolve;
      // The real pipeline checks the signal at every step and throws, so a
      // double that ignored it would let disposal look faster than it is.
      args.signal.addEventListener("abort", () =>
        reject(new Error("Deployment cancelled.")),
      );
    });
  });
  return {
    run: run as unknown as RunDeployPipeline,
    calls: run,
    release: (value: { url: string | null }) => release(value),
    signal: () => signal,
  };
}

/** Each test owns its registry, so nothing leaks between them. */
function makeRegistry(runPipeline: RunDeployPipeline) {
  return new CoolifyDeployRegistry({
    clock: createFakeClock(),
    ids: createSequentialIdSource(),
    runPipeline,
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("requestDeploy", () => {
  it("moves to running and notifies listeners", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    const seen: CoolifyDeployState[] = [];
    registry.onSnapshot((_, state) => seen.push(state));

    registry.requestDeploy(1);
    await flush();

    expect(registry.getSnapshot(1).type).toBe("running");
    expect(seen.at(0)?.type).toBe("running");
  });

  it("ignores a second request while one is running", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);

    registry.requestDeploy(1);
    await flush();
    registry.requestDeploy(1);

    expect(harness.calls).toHaveBeenCalledTimes(1);
  });
});

describe("cancelDeploy", () => {
  it("aborts the running pipeline and returns to idle", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();

    registry.cancelDeploy(1);

    expect(harness.signal().aborted).toBe(true);
    expect(registry.getSnapshot(1)).toEqual({ type: "idle" });
  });

  it("a cancelled pipeline that still finishes cannot revive the state", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();
    registry.cancelDeploy(1);

    // The pipeline had already passed its last abort check.
    harness.release({ url: "https://late.example.com" });
    await flush();

    expect(registry.getSnapshot(1)).toEqual({ type: "idle" });
  });

  it("leaves another app's deployment alone", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();

    registry.cancelDeploy(2);

    expect(harness.signal().aborted).toBe(false);
    expect(registry.getSnapshot(1).type).toBe("running");
  });
});

describe("failure", () => {
  it("records the message", async () => {
    const run = vi.fn().mockRejectedValue(new Error("build exploded"));
    const registry = makeRegistry(run as unknown as RunDeployPipeline);

    registry.requestDeploy(1);
    await vi.waitFor(() => {
      expect(registry.getSnapshot(1).type).toBe("failed");
    });

    const snapshot = registry.getSnapshot(1);
    if (snapshot.type !== "failed") throw new Error("expected failed");
    expect(snapshot.error).toBe("build exploded");
  });
});

describe("disposal", () => {
  it("aborts a running pipeline and forgets the app", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();

    await registry.dispose(1);

    expect(harness.signal().aborted).toBe(true);
    expect(registry.getSnapshot(1)).toEqual({ type: "idle" });
  });

  it("a late report after disposal does not resurrect the machine", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();
    const report = harness.calls.mock.calls[0][0].report;

    await registry.dispose(1);
    report.log("still chattering\n");
    harness.release({ url: "https://late.example.com" });
    await flush();

    expect(registry.getSnapshot(1)).toEqual({ type: "idle" });
    expect(registry.hasMachine(1)).toBe(false);
  });

  it("disposeAll drops every app's machine", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    registry.requestDeploy(2);
    await flush();

    await registry.disposeAll();

    expect(registry.hasMachine(1)).toBe(false);
    expect(registry.hasMachine(2)).toBe(false);
  });
});

describe("draining on disposal", () => {
  it("waits for the pipeline to unwind before returning", async () => {
    // resetAll closes and deletes the database straight after; returning early
    // would leave the pipeline running against a closed handle.
    let settled = false;
    // Unwinding takes a real tick, as it does in production where the abort has
    // to propagate out of an in-flight fetch. Without the drain, dispose
    // returns before this runs.
    const run = vi.fn(async (args: Parameters<RunDeployPipeline>[0]) => {
      await new Promise<void>((resolve) =>
        args.signal.addEventListener("abort", () => setTimeout(resolve, 25)),
      );
      settled = true;
      return { url: null };
    });
    const registry = makeRegistry(run as unknown as RunDeployPipeline);
    registry.requestDeploy(1);
    await flush();

    await registry.dispose(1);

    expect(settled).toBe(true);
  });

  it("refuses a deploy admitted while the app is being deleted", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    // Deletion holds the fence across everything it does, not just disposal.
    registry.beginAppDeletion(1);
    await registry.dispose(1);

    registry.requestDeploy(1);
    await flush();

    expect(harness.calls).not.toHaveBeenCalled();
    expect(registry.hasMachine(1)).toBe(false);

    registry.endAppDeletion(1);
    registry.requestDeploy(1);
    await flush();
    expect(harness.calls).toHaveBeenCalledTimes(1);
  });
});

describe("draining work the machine no longer points at", () => {
  it("waits for a cancelled pipeline that is still unwinding", async () => {
    // Cancelling moves the machine to idle while the pipeline keeps running,
    // so a disconnect followed by a delete must still wait for it: deletion
    // removes the app's files and row the moment dispose returns.
    let settled = false;
    const run = vi.fn(async (args: Parameters<RunDeployPipeline>[0]) => {
      await new Promise<void>((resolve) =>
        args.signal.addEventListener("abort", () => setTimeout(resolve, 25)),
      );
      settled = true;
      return { url: null };
    });
    const registry = makeRegistry(run as unknown as RunDeployPipeline);
    registry.requestDeploy(1);
    await flush();

    registry.cancelDeploy(1);
    await flush();
    await registry.dispose(1);

    expect(settled).toBe(true);
  });

  it("gives up on a pipeline that ignores its abort rather than hanging", async () => {
    // resetAll closes the database next, so a pipeline parked somewhere with
    // no abort signal must not block it forever.
    const run = vi.fn(() => new Promise<{ url: string | null }>(() => {}));
    const registry = makeRegistry(run as unknown as RunDeployPipeline);
    registry.requestDeploy(1);
    await flush();

    await expect(registry.disposeAll()).resolves.toBeUndefined();
  }, 15_000);
});
