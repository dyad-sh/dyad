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

function createRecoveringConnection() {
  let failing = true;
  const connection: PlanHandoffRemoteConnection = {
    getStatus: () => "connected",
    onStatusChange: () => () => undefined,
    onSnapshot: () => () => undefined,
    onDisposed: () => () => undefined,
    subscribe: (address) =>
      failing
        ? Promise.reject(new Error("temporary outage"))
        : Promise.resolve({
            ...address,
            actorInstanceId: "plan-actor",
            revision: 0,
            encodedState: {
              schemaVersion: 1,
              sourceChatId: 42,
              revision: 0,
              handoffId: null,
              targetChatId: null,
              planId: null,
              phase: "idle",
              failure: null,
            },
          }),
    unsubscribe: () => Promise.resolve(),
    dispatch: () => Promise.reject(new Error("not used")),
    start: () => () => undefined,
  };
  return {
    connection,
    recover: () => {
      failing = false;
    },
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
  it("starts a subscription-only renderer and follows later snapshots", async () => {
    let deliverSnapshot: (payload: unknown) => void = () => undefined;
    const start = vi.fn(() => () => undefined);
    const connection: PlanHandoffRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: (listener) => {
        deliverSnapshot = listener;
        return () => undefined;
      },
      onDisposed: () => () => undefined,
      subscribe: async (address) => ({
        ...address,
        actorInstanceId: "plan-actor",
        revision: 1,
        encodedState: {
          schemaVersion: 1,
          sourceChatId: 42,
          revision: 1,
          handoffId: "handoff",
          targetChatId: null,
          planId: "chat-42",
          phase: "persisting",
          failure: null,
        },
      }),
      unsubscribe: () => Promise.resolve(),
      dispatch: vi.fn(),
      start,
    };
    const manager = new PlanHandoffRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    const listener = vi.fn();

    const release = manager.subscribeKey(42, listener);
    await waitFor(() => manager.getSnapshot(42).phase === "persisting");
    deliverSnapshot({
      protocolVersion: 1,
      machineId: "plan_handoff",
      encodedKey: { sourceChatId: 42 },
      actorInstanceId: "plan-actor",
      revision: 2,
      encodedState: {
        schemaVersion: 1,
        sourceChatId: 42,
        revision: 2,
        handoffId: "handoff",
        targetChatId: 77,
        planId: "chat-42",
        phase: "started",
        failure: null,
      },
    });

    await waitFor(() => manager.getSnapshot(42).phase === "started");
    expect(start).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();

    release();
    manager.dispose();
  });

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
    expect(manager.getSnapshot(42)).toBe(manager.getSnapshot(42));
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

  it("clears a bootstrap failure after a successful resync", async () => {
    const recovering = createRecoveringConnection();
    const manager = new PlanHandoffRemoteManager(
      createSequentialIdSource(),
      recovering.connection,
    );

    manager.start();
    const first = manager.subscribeKey(42, () => undefined);
    await waitFor(() => manager.getSnapshot(42).phase === "failed");

    recovering.recover();
    const second = manager.subscribeKey(42, () => undefined);
    await waitFor(() => manager.getSnapshot(42).phase === "idle");

    expect(manager.getSnapshot(42).failure).toBeNull();
    first();
    second();
    manager.dispose();
  });

  it("keeps the remote subscription across an immediate remount", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const connection: PlanHandoffRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: () => () => undefined,
      onDisposed: () => () => undefined,
      subscribe: async (address) => ({
        ...address,
        actorInstanceId: "plan-actor",
        revision: 0,
        encodedState: {
          schemaVersion: 1,
          sourceChatId: 42,
          revision: 0,
          handoffId: null,
          targetChatId: null,
          planId: null,
          phase: "idle",
          failure: null,
        },
      }),
      unsubscribe,
      dispatch: () => Promise.reject(new Error("not used")),
      start: () => () => undefined,
    };
    const manager = new PlanHandoffRemoteManager(
      createSequentialIdSource(),
      connection,
    );

    const first = manager.subscribeKey(42, () => undefined);
    await waitFor(() => manager.getSnapshot(42).phase === "idle");
    first();
    const second = manager.subscribeKey(42, () => undefined);
    await flush();

    expect(unsubscribe).not.toHaveBeenCalled();

    second();
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    manager.dispose();
  });
});
