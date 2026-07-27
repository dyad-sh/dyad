import { describe, expect, it, vi } from "vitest";
import type {
  MachineAddress,
  MachineDispatchEnvelope,
  MachineDispatchReceipt,
  MachineSnapshotEnvelope,
} from "@/distributed_machines/remote_protocol";
import { createSequentialIdSource } from "@/state_machines/testing";
import {
  PlanHandoffRemoteManager,
  type PlanHandoffRemoteConnection,
} from "./remote_manager";

function createFailingConnection(error: Error): PlanHandoffRemoteConnection {
  return {
    getStatus: () => "connected",
    onStatusChange: () => () => undefined,
    onSnapshot: () => () => undefined,
    onDisposed: () => () => undefined,
    subscribe: (_address: MachineAddress): Promise<MachineSnapshotEnvelope> =>
      Promise.reject(error),
    unsubscribe: (_address: MachineAddress) => Promise.resolve(),
    dispatch: (
      _envelope: MachineDispatchEnvelope,
    ): Promise<MachineDispatchReceipt> => Promise.reject(error),
    start: () => () => undefined,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error("Timed out waiting for plan handoff state");
}

describe("PlanHandoffRemoteManager", () => {
  it("publishes bootstrap failures through the plan handoff snapshot", async () => {
    const manager = new PlanHandoffRemoteManager(
      createSequentialIdSource(),
      createFailingConnection(new Error("gateway unavailable")),
    );
    const listener = vi.fn();

    manager.start();
    const unsubscribe = manager.subscribeKey(42, listener);
    await waitFor(() => manager.getSnapshot(42).phase === "failed");

    expect(manager.getSnapshot(42)).toMatchObject({
      sourceChatId: 42,
      phase: "failed",
      failure: "gateway unavailable",
    });
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    manager.dispose();
  });

  it("publishes acceptance failures and preserves them after rejection", async () => {
    const manager = new PlanHandoffRemoteManager(
      createSequentialIdSource(),
      createFailingConnection(new Error("accept failed")),
    );
    const listener = vi.fn();

    manager.start();
    const unsubscribe = manager.subscribeKey(42, listener);
    await flush();
    listener.mockClear();

    await expect(
      manager.accept({
        sourceChatId: 42,
        appId: 7,
        acceptInNewChat: false,
        planHash: "hash",
        plan: {
          title: "Plan",
          content: "Implement it",
        },
      }),
    ).rejects.toThrow("accept failed");

    expect(manager.getSnapshot(42)).toMatchObject({
      phase: "failed",
      failure: "accept failed",
    });
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    manager.dispose();
  });
});
