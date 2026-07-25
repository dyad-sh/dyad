import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import { FakeDuplexRemoteTransport } from "@/distributed_machines/testing";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import { appRunClientDefinition } from "./client_definition";
import { appRunDefinition } from "./definition";
import { appRunKey } from "./transport";
import { AppRunRemoteManager } from "./remote_manager";

const runtime = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  restart: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
  cleanup: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(async () => ({ id: 7 })),
      },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  apps: { id: "id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));

vi.mock("@/lib/log_store", () => ({
  addLog: vi.fn(),
  clearLogs: vi.fn(),
}));

vi.mock("@/ipc/services/app_runtime_service", () => ({
  appRuntimeService: runtime,
}));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
  });
  const manifest = createRemoteMachineManifest([appRunDefinition]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  const first = new RemoteMachineClient(
    duplex.connect(),
    createSequentialIdSource(),
  );
  const second = new RemoteMachineClient(
    duplex.connect(),
    createSequentialIdSource(),
  );
  first.start();
  second.start();
  const actorA = first.actor(appRunClientDefinition, appRunKey(7));
  const actorB = second.actor(appRunClientDefinition, appRunKey(7));
  const releaseA = actorA.subscribe(() => undefined);
  const releaseB = actorB.subscribe(() => undefined);
  return { actorA, actorB, duplex, host, releaseA, releaseB, transport };
}

describe("main-hosted app-run actor", () => {
  beforeEach(() => {
    runtime.start.mockReset();
    runtime.restart.mockReset();
    runtime.stop.mockReset();
    runtime.cleanup.mockReset();
    runtime.start.mockResolvedValue(undefined);
    runtime.restart.mockResolvedValue(undefined);
    runtime.stop.mockResolvedValue(undefined);
  });

  it("shares one actor across windows and preserves proxy-before-spawn ordering", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { actorA, actorB, host, transport } = createHarness();
    await actorA.resync();
    await actorB.resync();

    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({ totalReferences: 2 }),
    ]);
    const start = await actorA.dispatch({
      type: "START",
      operationId: "start-a",
      startedAt: 10,
      expectedRevision: 0,
    });
    expect(start.kind).toBe("applied");
    expect(actorB.getSnapshot()).toMatchObject({
      phase: "starting",
      previewReloadEpoch: 0,
      invocationRef: { operationId: "start-a" },
    });

    host.ensure(appRunDefinition, appRunKey(7)).send({
      type: "PROXY_READY",
      invocationRef: {
        kind: "app-run",
        entityKey: 7,
        operationId: "start-a",
      },
      url: {
        appUrl: "http://localhost:3210",
        originalUrl: "http://localhost:5173",
        mode: "host",
      },
    });
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "starting",
      previewReloadEpoch: 0,
      url: null,
    });

    pending.resolve();
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      previewReloadEpoch: 1,
      lastSettlement: {
        operationId: "start-a",
        kind: "run",
        outcome: "succeeded",
      },
      url: { appUrl: "http://localhost:3210" },
    });
    expect(actorB.getSnapshot()).toStrictEqual(actorA.getSnapshot());
    expect(runtime.start).toHaveBeenCalledTimes(1);

    const restart = await actorB.dispatch({
      type: "RESTART",
      operation: "restart",
      operationId: "restart-b",
      startedAt: 20,
      expectedRevision: actorB.getSnapshot().revision,
      options: { removeNodeModules: false, recreateSandbox: true },
    });
    expect(restart.kind).toBe("applied");
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      previewReloadEpoch: 2,
      invocationRef: { operationId: "restart-b" },
    });
    expect(runtime.restart).toHaveBeenCalledTimes(1);

    host.ensure(appRunDefinition, appRunKey(7)).send({
      type: "HMR_DETECTED",
      invocationRef: {
        kind: "app-run",
        entityKey: 7,
        operationId: "restart-b",
      },
    });
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      previewReloadEpoch: 3,
    });
  });

  it("resolves renderer dispatch only after the matching runtime settles", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    let settled = false;

    const dispatch = manager
      .dispatch(7, { type: "START", startedAt: 10 })
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => {
      expect(runtime.start).toHaveBeenCalledTimes(1);
    });
    expect(settled).toBe(false);

    pending.resolve();
    await dispatch;
    expect(settled).toBe(true);
    manager.dispose();
  });

  it("rejects a stale restart and requires stop to target the active invocation", async () => {
    const { actorA, actorB } = createHarness();
    await actorA.resync();
    await actorB.resync();
    const [started, stale] = await Promise.all([
      actorA.dispatch({
        type: "START",
        operationId: "start-a",
        startedAt: 10,
        expectedRevision: 0,
      }),
      actorB.dispatch({
        type: "RESTART",
        operation: "restart",
        operationId: "restart-b",
        startedAt: 20,
        expectedRevision: 0,
        options: { removeNodeModules: false, recreateSandbox: false },
      }),
    ]);
    expect(started.kind).toBe("applied");
    await flush();
    expect(stale).toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });

    const wrongCancel = await actorB.dispatch({
      type: "STOP_REQUESTED",
      operationId: "stop-b",
      startedAt: 30,
      activeInvocationRef: {
        kind: "app-run",
        entityKey: 7,
        operationId: "not-active",
      },
    });
    expect(wrongCancel).toMatchObject({
      kind: "rejected",
      reason: "unauthorized",
    });
  });

  it("retains work when the initiating window releases its subscription", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { actorA, actorB, releaseA, transport } = createHarness();
    await actorA.resync();
    await actorB.resync();
    await actorA.dispatch({
      type: "START",
      operationId: "start-a",
      startedAt: 10,
      expectedRevision: 0,
    });

    releaseA();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);
    pending.resolve();
    await flush();
    expect(actorB.getSnapshot().phase).toBe("ready");
  });
});
