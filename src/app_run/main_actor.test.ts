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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { AppRunActorService } from "@/ipc/services/app_run_actor_service";
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

const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 7 }) as { id: number } | undefined),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: database.findFirst,
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
    database.findFirst.mockReset();
    database.findFirst.mockResolvedValue({ id: 7 });
    runtime.start.mockResolvedValue(undefined);
    runtime.restart.mockResolvedValue(undefined);
    runtime.stop.mockResolvedValue(undefined);
  });

  it("authorizes manual reload independently of the current phase", async () => {
    const { actorA } = createHarness();
    await actorA.resync();

    await expect(
      actorA.dispatch({
        type: "MANUAL_RELOAD",
        operationId: "reload-idle",
        startedAt: 1,
      }),
    ).resolves.toMatchObject({
      kind: "applied",
    });
  });

  it("uses NotFound for trusted missing-app access and Auth remotely", async () => {
    database.findFirst.mockResolvedValue(undefined);
    const service = new AppRunActorService();

    await expect(service.getRunState(7)).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
    });
    await expect(
      appRunDefinition.remote.authorizeSubscribe?.({
        key: appRunKey(7),
      } as never),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
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

    const ensureRunning = await actorB.dispatch({
      type: "START",
      operationId: "ensure-running",
      startedAt: 15,
      expectedRevision: actorB.getSnapshot().revision,
    });
    expect(ensureRunning.kind).toBe("applied");
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      invocationRef: { operationId: "start-a" },
      lastSettlement: {
        operationId: "ensure-running",
        kind: "run",
        outcome: "succeeded",
      },
    });
    expect(runtime.start).toHaveBeenCalledTimes(2);

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

  it("rejects renderer dispatch when the runtime settlement fails", async () => {
    runtime.start.mockRejectedValue(
      new DyadError("spawn failed", DyadErrorKind.External),
    );
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    await expect(
      manager.dispatch(7, { type: "START", startedAt: 10 }),
    ).rejects.toMatchObject({
      message: "spawn failed",
      kind: DyadErrorKind.External,
    });
    manager.dispose();
  });
  it("rejects renderer dispatch when reset disposes its actor", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex, host } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    const dispatch = manager.dispatch(7, { type: "START", startedAt: 10 });
    await vi.waitFor(() => {
      expect(runtime.start).toHaveBeenCalledTimes(1);
    });
    await host.disposeMachine(appRunDefinition.id);

    await expect(dispatch).rejects.toThrow("subscription was disposed");
    manager.dispose();
  });

  it("releases transport subscriptions when an app is no longer observed", async () => {
    const { duplex, transport } = createHarness();
    const connection = duplex.connect();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    const unsubscribe = manager.subscribeKey(1000, () => undefined);
    await vi.waitFor(() => {
      expect(
        transport
          .inspectSubscriptions()
          .some((entry) => (entry.key as { appId: number }).appId === 1000),
      ).toBe(true);
    });
    unsubscribe();
    await vi.waitFor(() => {
      expect(
        transport
          .inspectSubscriptions()
          .some((entry) => (entry.key as { appId: number }).appId === 1000),
      ).toBe(false);
    });

    manager.stop();
    for (let appId = 1001; appId < 1261; appId += 1) {
      manager.subscribeKey(appId, () => undefined)();
    }
    expect(
      (
        manager as unknown as {
          actorSubscriptions: Map<number, unknown>;
        }
      ).actorSubscriptions.size,
    ).toBe(0);

    manager.dispose();
  });

  it("temporarily subscribes an unobserved actor for manual reload", async () => {
    const { actorA, actorB, duplex, host, releaseA, releaseB, transport } =
      createHarness();
    await actorA.resync();
    await actorB.resync();
    await actorA.dispatch({
      type: "START",
      operationId: "initial",
      startedAt: 1,
      expectedRevision: 0,
    });
    await flush();
    releaseA();
    releaseB();
    await vi.waitFor(() => {
      expect(transport.inspectSubscriptions()).toHaveLength(0);
    });

    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    manager.requestManualReload(7);

    await vi.waitFor(() => {
      expect(
        host.ensure(appRunDefinition, appRunKey(7)).getSnapshot(),
      ).toMatchObject({
        runState: { type: "ready" },
        previewReloadEpoch: 1,
      });
    });
    await vi.waitFor(() => {
      expect(transport.inspectSubscriptions()).toHaveLength(0);
    });
    manager.dispose();
  });

  it("rejects main lifecycle waiters when their actor is disposed", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { host } = createHarness();
    const service = new AppRunActorService(host);

    const dispatch = service.dispatchStart(7, {
      operationId: "start-before-reset",
      startedAt: 10,
    });
    await vi.waitFor(() => {
      expect(runtime.start).toHaveBeenCalledTimes(1);
    });
    await service.disposeAllApps();

    await expect(dispatch).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
  });

  it("classifies ignored main lifecycle races as conflicts", async () => {
    const { host } = createHarness();
    const service = new AppRunActorService(host);
    await service.dispatchStart(7, {
      operationId: "active-run",
      startedAt: 10,
    });

    await expect(
      service.dispatchStop(7, {
        operationId: "stale-stop",
        startedAt: 20,
        activeInvocationRef: {
          kind: "app-run",
          entityKey: 7,
          operationId: "not-active",
        },
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
    });
  });

  it("keeps restart cleanup options distinct from a pnpm rebuild", async () => {
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    await manager.dispatch(7, {
      type: "RESTART",
      startedAt: 10,
      options: { removeNodeModules: true, recreateSandbox: false },
    });

    expect(runtime.restart).toHaveBeenCalledWith(
      expect.objectContaining({
        removeNodeModules: true,
        recreateSandbox: false,
      }),
    );
    manager.dispose();
  });

  it("settles a superseded ensure-running request under its request ID", async () => {
    const { actorA } = createHarness();
    await actorA.resync();
    await actorA.dispatch({
      type: "START",
      operationId: "initial",
      startedAt: 1,
      expectedRevision: 0,
    });
    await flush();

    const pendingEnsure = deferred<void>();
    runtime.start.mockReturnValueOnce(pendingEnsure.promise);
    await actorA.dispatch({
      type: "START",
      operationId: "ensure-running",
      startedAt: 2,
      expectedRevision: actorA.getSnapshot().revision,
    });
    await actorA.dispatch({
      type: "RESTART",
      operation: "restart",
      operationId: "replacement",
      startedAt: 3,
      expectedRevision: actorA.getSnapshot().revision,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      invocationRef: { operationId: "replacement" },
      lastSettlement: { operationId: "replacement" },
    });

    pendingEnsure.resolve();
    await flush();
    expect(actorA.getSnapshot()).toMatchObject({
      phase: "ready",
      invocationRef: { operationId: "replacement" },
      lastSettlement: {
        operationId: "ensure-running",
        outcome: "succeeded",
      },
    });
  });

  it("settles shared-runtime requests by request ID", () => {
    const sharedInvocation = {
      kind: "app-run",
      entityKey: 7,
      operationId: "runtime",
    } as const;
    const result = appRunDefinition.transition(
      {
        runState: {
          type: "ready",
          appId: 7,
          invocationRef: sharedInvocation,
          url: null,
        },
        previewReloadEpoch: 0,
        observedExit: null,
        reusableStartInvocation: null,
        pendingOperations: [
          {
            operationId: "request-a",
            invocationRef: sharedInvocation,
          },
          {
            operationId: "request-b",
            invocationRef: sharedInvocation,
          },
        ],
        lastSettlement: null,
      },
      {
        type: "PROCESS_FAILED",
        operationId: "request-b",
        invocationRef: sharedInvocation,
        error: { message: "request B failed" },
      },
      appRunKey(7),
    );

    expect(result).toMatchObject({
      kind: "applied",
      state: {
        pendingOperations: [{ operationId: "request-a" }],
        lastSettlement: {
          operationId: "request-b",
          outcome: "failed",
          error: { message: "request B failed" },
        },
      },
    });
  });

  it("mints a fresh invocation when retrying an ordinary errored start", () => {
    const liveInvocation = {
      kind: "app-run",
      entityKey: 7,
      operationId: "still-installing",
    } as const;
    const result = appRunDefinition.transition(
      {
        runState: {
          type: "errored",
          appId: 7,
          invocationRef: liveInvocation,
          error: { message: "readiness timed out" },
        },
        previewReloadEpoch: 0,
        observedExit: null,
        reusableStartInvocation: null,
        pendingOperations: [],
        lastSettlement: null,
      },
      {
        type: "START",
        operationId: "retry-request",
        startedAt: 20,
        expectedRevision: 1,
      },
      appRunKey(7),
    );

    expect(result).toMatchObject({
      kind: "applied",
      state: {
        runState: {
          type: "starting",
          invocationRef: {
            operationId: "retry-request",
          },
        },
        pendingOperations: [
          {
            operationId: "retry-request",
            invocationRef: {
              operationId: "retry-request",
            },
          },
        ],
      },
      commands: [
        {
          type: "start",
          operationId: "retry-request",
          invocationRef: {
            operationId: "retry-request",
          },
        },
      ],
    });
  });

  it("reuses a live external invocation after readiness failure", () => {
    const liveInvocation = {
      kind: "app-run",
      entityKey: 7,
      operationId: "still-installing",
    } as const;
    const failed = appRunDefinition.transition(
      {
        runState: {
          type: "starting",
          appId: 7,
          invocationRef: liveInvocation,
          operation: "restart",
          startedAt: 10,
          pendingUrl: null,
        },
        previewReloadEpoch: 0,
        observedExit: null,
        reusableStartInvocation: null,
        pendingOperations: [],
        lastSettlement: null,
      },
      {
        type: "PROCESS_FAILED",
        operationId: liveInvocation.operationId,
        invocationRef: liveInvocation,
        error: { message: "readiness timed out" },
        runtimeMayBeLive: true,
      },
      appRunKey(7),
    );
    expect(failed.kind).toBe("applied");
    if (failed.kind !== "applied") throw new Error("expected applied");

    const retried = appRunDefinition.transition(
      failed.state,
      {
        type: "START",
        operationId: "retry-request",
        startedAt: 20,
        expectedRevision: 1,
      },
      appRunKey(7),
    );

    expect(retried).toMatchObject({
      kind: "applied",
      state: {
        runState: { type: "starting", invocationRef: liveInvocation },
        reusableStartInvocation: null,
      },
      commands: [{ type: "start", invocationRef: liveInvocation }],
    });
  });

  it("records a current exit even when RunState ignores it", () => {
    const invocationRef = {
      kind: "app-run",
      entityKey: 7,
      operationId: "failed-run",
    } as const;
    const result = appRunDefinition.transition(
      {
        runState: {
          type: "errored",
          appId: 7,
          invocationRef,
          error: { message: "readiness timed out" },
        },
        previewReloadEpoch: 0,
        observedExit: null,
        reusableStartInvocation: invocationRef,
        pendingOperations: [],
        lastSettlement: null,
      },
      {
        type: "PROCESS_EXITED",
        invocationRef,
        exitCode: 1,
        timestamp: 30,
      },
      appRunKey(7),
    );

    expect(result).toMatchObject({
      kind: "applied",
      state: {
        runState: { type: "errored" },
        observedExit: { exitCode: 1, timestamp: 30 },
        reusableStartInvocation: null,
      },
    });
  });

  it("keeps only a later ignored exit in the actor fallback", () => {
    const invocationRef = {
      kind: "app-run",
      entityKey: 7,
      operationId: "completed-run",
    } as const;
    const initial = {
      runState: {
        type: "ready" as const,
        appId: 7,
        invocationRef,
        url: null,
      },
      previewReloadEpoch: 0,
      observedExit: null,
      reusableStartInvocation: null,
      pendingOperations: [],
      lastSettlement: null,
    };
    const first = appRunDefinition.transition(
      initial,
      {
        type: "PROCESS_EXITED",
        invocationRef,
        exitCode: 1,
        timestamp: 20,
      },
      appRunKey(7),
    );
    expect(first).toMatchObject({
      kind: "applied",
      state: {
        runState: { type: "stopped", timestamp: 20 },
        observedExit: null,
      },
    });
    if (first.kind !== "applied") throw new Error("expected applied");

    const second = appRunDefinition.transition(
      first.state,
      {
        type: "PROCESS_EXITED",
        invocationRef,
        exitCode: 2,
        timestamp: 30,
      },
      appRunKey(7),
    );

    expect(second).toMatchObject({
      kind: "applied",
      state: {
        runState: { type: "stopped", timestamp: 20 },
        observedExit: { exitCode: 2, timestamp: 30 },
      },
    });
  });

  it("treats a concurrent ensure-running revision conflict as success", async () => {
    const { duplex, host } = createHarness();
    const connection = duplex.connect();
    connection.dispatch = vi.fn(async (envelope) => {
      host.ensure(appRunDefinition, appRunKey(7)).send({
        type: "START",
        operationId: "other-window",
        startedAt: 9,
        expectedRevision: 0,
      });
      return {
        kind: "rejected" as const,
        messageId: envelope.messageId,
        reason: "revision-conflict" as const,
      };
    });
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    await expect(
      manager.dispatch(7, { type: "START", startedAt: 10 }),
    ).resolves.toBeUndefined();
    expect(runtime.start).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("removes the settlement waiter when remote dispatch throws", async () => {
    const { duplex } = createHarness();
    const connection = duplex.connect();
    connection.dispatch = vi.fn(async () => {
      throw new Error("transport disconnected");
    });
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    await expect(
      manager.dispatch(7, { type: "START", startedAt: 10 }),
    ).rejects.toThrow("transport disconnected");
    expect(
      (
        manager as unknown as {
          settlementWaiters: Map<string, unknown>;
        }
      ).settlementWaiters.size,
    ).toBe(0);
    manager.dispose();
  });

  it("rejects a stale restart and requires stop to target the active invocation", async () => {
    const { actorA, actorB, host } = createHarness();
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

    const directStaleCancel = await host
      .ensure(appRunDefinition, appRunKey(7))
      .enqueue({
        type: "STOP_REQUESTED",
        operationId: "direct-stop",
        startedAt: 40,
        activeInvocationRef: {
          kind: "app-run",
          entityKey: 7,
          operationId: "not-active",
        },
      }).settled;
    expect(directStaleCancel).toMatchObject({
      kind: "ignored",
      reason: "stale-operation",
    });
    expect(runtime.stop).not.toHaveBeenCalled();
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
