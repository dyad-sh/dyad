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
    return new Promise<{ url: string | null }>((r) => {
      release = r;
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

    registry.dispose(1);

    expect(harness.signal().aborted).toBe(true);
    expect(registry.getSnapshot(1)).toEqual({ type: "idle" });
  });

  it("a late report after disposal does not resurrect the machine", async () => {
    const harness = pendingPipeline();
    const registry = makeRegistry(harness.run);
    registry.requestDeploy(1);
    await flush();
    const report = harness.calls.mock.calls[0][0].report;

    registry.dispose(1);
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

    registry.disposeAll();

    expect(registry.hasMachine(1)).toBe(false);
    expect(registry.hasMachine(2)).toBe(false);
  });
});
