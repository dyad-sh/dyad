import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import {
  RemoteMachineClient,
  RemoteMachineTransportError,
} from "@/distributed_machines/remote_client";
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
import { appRunOperationRegistry } from "./operations";

const runtime = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  restart: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
  cleanup: vi.fn(),
  createExternalLifecycleRef: vi.fn(),
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
    runtime.createExternalLifecycleRef.mockReset();
    runtime.createExternalLifecycleRef.mockReturnValue({
      kind: "app-run",
      entityKey: 7,
      operationId: "external-restart",
    });
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

    const [[startOptions]] = runtime.start.mock.calls as unknown as [
      [{ output: { enqueue(output: unknown): void } }],
    ];
    startOptions.output.enqueue({
      type: "stdout",
      appId: 7,
      message:
        "[dyad-proxy-server]started=[http://localhost:3210] original=[http://localhost:5173] mode=[host]",
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

  it("settles a pending run after an unrelated manual reload revision", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex, host } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    const request = manager.dispatch(7, { type: "START", startedAt: 10 });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    await host.ensure(appRunDefinition, appRunKey(7)).enqueue({
      type: "MANUAL_RELOAD",
      operationId: "reload-during-start",
      startedAt: 20,
    }).settled;

    pending.resolve();

    await expect(request).resolves.toBeUndefined();
    expect(
      host.ensure(appRunDefinition, appRunKey(7)).getSnapshot(),
    ).toMatchObject({
      runState: { type: "ready" },
      lastSettlement: {
        kind: "run",
        outcome: "succeeded",
      },
    });
    manager.dispose();
  });

  it("forwards request-owned snapshots without a keyed UI subscriber", async () => {
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    const listener = vi.fn();
    manager.subscribeRunStateChanged(listener);

    await manager.dispatch(7, { type: "START", startedAt: 10 });

    expect(listener).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        phase: "ready",
        lastSettlement: expect.objectContaining({
          kind: "run",
          outcome: "succeeded",
        }),
      }),
    );
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

  it("settles a synchronous command-runner failure as a run failure", async () => {
    runtime.start.mockImplementationOnce(() => {
      throw new Error("runner exploded");
    });
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    await expect(
      manager.dispatch(7, { type: "START", startedAt: 10 }),
    ).rejects.toThrow("runner exploded");
    expect(appRunOperationRegistry.inspect().total).toBe(0);
    manager.dispose();
  });

  it("settles stop success and stop failure through their own requests", async () => {
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    const unsubscribe = manager.subscribeKey(7, () => undefined);
    await manager.dispatch(7, { type: "START", startedAt: 10 });

    await expect(
      manager.dispatch(7, { type: "STOP", startedAt: 20 }),
    ).resolves.toBeUndefined();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(appRunOperationRegistry.inspect().total).toBe(0);
    unsubscribe();
    manager.dispose();

    const failingHarness = createHarness();
    const failingManager = new AppRunRemoteManager(
      createSequentialIdSource(),
      failingHarness.duplex.connect(),
    );
    failingManager.start();
    const unsubscribeFailing = failingManager.subscribeKey(7, () => undefined);
    await failingManager.dispatch(7, { type: "START", startedAt: 30 });
    runtime.stop.mockRejectedValueOnce(new Error("stop failed"));

    await expect(
      failingManager.dispatch(7, { type: "STOP", startedAt: 40 }),
    ).rejects.toThrow("stop failed");
    expect(appRunOperationRegistry.inspect().total).toBe(0);
    unsubscribeFailing();
    failingManager.dispose();
  });

  it("treats actor disposal as an expected renderer cancellation", async () => {
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

    await expect(dispatch).resolves.toBeUndefined();
    manager.dispose();
  });

  it("settles a run when process exit wins the race with command failure", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex, host } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();

    const request = manager.dispatch(7, { type: "START", startedAt: 10 });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    const actor = host.ensure(appRunDefinition, appRunKey(7));
    const runState = actor.getSnapshot().runState;
    if (runState.type === "idle") throw new Error("Expected an active run");
    const [[startOptions]] = runtime.start.mock.calls as unknown as [
      [
        {
          output: {
            send(event: {
              type: "app-exit";
              appId: number;
              message: string;
              exitCode: number;
              timestamp: number;
            }): void;
          };
        },
      ],
    ];
    startOptions.output.send({
      type: "app-exit",
      appId: 7,
      message: "process exited",
      exitCode: 1,
      timestamp: 20,
    });
    pending.reject(new Error("process exited before readiness"));

    await expect(request).rejects.toThrow("process exited before readiness");
    expect(appRunOperationRegistry.inspect().total).toBe(0);
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
    await vi.waitFor(() => {
      expect(
        transport
          .inspectSubscriptions()
          .filter((entry) => (entry.key as { appId: number }).appId !== 7),
      ).toHaveLength(0);
    });

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

  it("rejects output captured by a superseded runtime invocation", async () => {
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
        operationId: "replacement",
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
      },
      commands: [
        {
          type: "start",
          requestId: "retry-request",
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

  it("settles from the protocol-v1 runtime correlation fallback", async () => {
    const { duplex, host } = createHarness();
    const connection = duplex.connect();
    connection.dispatch = vi.fn(async (envelope) => {
      const actor = host.ensure(appRunDefinition, appRunKey(7));
      actor.send(envelope.encodedEvent as never);
      await flush();
      const metadata = actor.getMetadata();
      return {
        kind: "applied" as const,
        messageId: envelope.messageId,
        actorInstanceId: metadata.actorInstanceId,
        revision: metadata.snapshotRevision,
        transactionSequence: metadata.transactionSequence,
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

    expect(runtime.start).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it("settles protocol-v1 fallback ownership when the actor is disposed", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex, host, transport } = createHarness();
    const connection = duplex.connect();
    connection.dispatch = vi.fn(async (envelope) => {
      const actor = host.ensure(appRunDefinition, appRunKey(7));
      actor.send(envelope.encodedEvent as never);
      await flush();
      const metadata = actor.getMetadata();
      return {
        kind: "applied" as const,
        messageId: envelope.messageId,
        actorInstanceId: metadata.actorInstanceId,
        revision: metadata.snapshotRevision,
        transactionSequence: metadata.transactionSequence,
      };
    });
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    const request = manager.dispatch(7, { type: "START", startedAt: 10 });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    const disposal = host.disposeKey(
      appRunDefinition.id,
      appRunKey(7),
      "entity-deletion",
    );

    await expect(request).resolves.toBeUndefined();
    expect(
      (
        manager as unknown as {
          requestScope: { inspectActiveCount(): number };
        }
      ).requestScope.inspectActiveCount(),
    ).toBe(0);

    pending.resolve();
    await disposal;
    await vi.waitFor(() => {
      expect(transport.inspectSubscriptions()).toHaveLength(0);
    });
    manager.dispose();
  });

  it("detaches after post-send disconnect without stranding either owner", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex } = createHarness();
    const connection = duplex.connect();
    const dispatch = connection.dispatch.bind(connection);
    connection.dispatch = vi.fn(async (envelope) => {
      await dispatch(envelope);
      throw new RemoteMachineTransportError(
        "disconnected",
        "transport disconnected after send",
      );
    });
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    await expect(
      manager.dispatch(7, { type: "START", startedAt: 10 }),
    ).resolves.toBeUndefined();
    expect(
      (
        manager as unknown as {
          requestScope: { inspectActiveCount(): number };
        }
      ).requestScope.inspectActiveCount(),
    ).toBe(0);
    expect(appRunOperationRegistry.inspect().unresolved).toBe(1);

    pending.resolve();
    await vi.waitFor(() => {
      expect(appRunOperationRegistry.inspect().total).toBe(0);
    });
    manager.dispose();
  });

  it("does not mistake post-admission transport loss for actor disposal", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex } = createHarness();
    const connection = duplex.connect();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();
    const prepared = manager.prepareRequest(7, {
      type: "START",
      startedAt: 10,
    });

    await expect(prepared.admission).resolves.toMatchObject({
      kind: "admitted",
    });
    connection.disconnect();
    let settled = false;
    void prepared.settled.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    manager.dispose();
    await expect(prepared.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
    pending.resolve();
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
    await flush();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);
    pending.resolve();
    await flush();
    expect(actorB.getSnapshot().phase).toBe("ready");
  });

  it("keeps logical request identity distinct from runtime invocation identity", async () => {
    const { duplex } = createHarness();
    const connection = duplex.connect();
    const originalDispatch = connection.dispatch.bind(connection);
    const envelopes: Parameters<typeof connection.dispatch>[0][] = [];
    connection.dispatch = vi.fn(async (envelope) => {
      envelopes.push(envelope);
      return originalDispatch(envelope);
    });
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    await manager.dispatch(7, { type: "START", startedAt: 10 });

    expect(envelopes).toHaveLength(1);
    const envelope = envelopes[0];
    if (!envelope) throw new Error("expected a captured dispatch");
    expect(envelope.correlationId).toBeTruthy();
    expect(envelope.correlationId).not.toBe(
      (envelope.encodedEvent as { operationId: string }).operationId,
    );
    expect(envelope.messageId).not.toBe(envelope.correlationId);
    expect(envelope.causationId).not.toBe(envelope.messageId);
    manager.dispose();
  });

  it("settles multiple pending requests only from their correlated outcomes", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    runtime.start
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { duplex } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    let firstSettled = false;
    let secondSettled = false;

    const firstRequest = manager
      .dispatch(7, { type: "START", startedAt: 10 })
      .then(() => {
        firstSettled = true;
      });
    const secondRequest = manager
      .dispatch(8, { type: "START", startedAt: 20 })
      .then(() => {
        secondSettled = true;
      });
    await vi.waitFor(() => {
      expect(runtime.start).toHaveBeenCalledTimes(2);
    });
    expect(appRunOperationRegistry.inspect().unresolved).toBe(2);

    second.resolve();
    await secondRequest;
    expect(secondSettled).toBe(true);
    expect(firstSettled).toBe(false);
    expect(appRunOperationRegistry.inspect().unresolved).toBe(1);

    first.resolve();
    await firstRequest;
    expect(appRunOperationRegistry.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
    manager.dispose();
  });

  it("settles a superseded renderer request without accepting old output", async () => {
    const oldRuntime = deferred<void>();
    runtime.start.mockReturnValue(oldRuntime.promise);
    const { duplex, host } = createHarness();
    const ids = createSequentialIdSource();
    const firstManager = new AppRunRemoteManager(ids, duplex.connect());
    const replacementManager = new AppRunRemoteManager(ids, duplex.connect());
    firstManager.start();
    replacementManager.start();

    const firstRequest = firstManager.dispatch(7, {
      type: "START",
      startedAt: 10,
    });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());

    await replacementManager.dispatch(7, {
      type: "RESTART",
      startedAt: 20,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await expect(firstRequest).resolves.toBeUndefined();
    const replacement = host
      .ensure(appRunDefinition, appRunKey(7))
      .getSnapshot().runState;
    expect(replacement.type).toBe("ready");

    oldRuntime.resolve();
    await flush();
    expect(
      host.ensure(appRunDefinition, appRunKey(7)).getSnapshot().runState,
    ).toEqual(replacement);
    expect(appRunOperationRegistry.inspect().total).toBe(0);
    firstManager.dispose();
    replacementManager.dispose();
  });

  it("settles window-owned operations when the renderer disconnects", async () => {
    const pending = deferred<void>();
    runtime.start.mockReturnValue(pending.promise);
    const { duplex } = createHarness();
    const connection = duplex.connect();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      connection,
    );
    manager.start();

    const request = manager.dispatch(7, { type: "START", startedAt: 10 });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    expect(appRunOperationRegistry.inspect().unresolved).toBe(1);

    connection.disconnect();
    await vi.waitFor(() => {
      expect(appRunOperationRegistry.inspect().total).toBe(0);
    });
    manager.dispose();
    await expect(request).resolves.toBeUndefined();
    pending.resolve();
  });

  it("fences app deletion synchronously and reopens only through its handle", async () => {
    const { actorA, host } = createHarness();
    await actorA.resync();
    const service = new AppRunActorService(host);
    const deletion = service.beginAppDeletion(7);

    await expect(
      actorA.dispatch({
        type: "START",
        operationId: "blocked",
        startedAt: 10,
        expectedRevision: actorA.getSnapshot().revision,
      }),
    ).resolves.toMatchObject({ kind: "rejected" });
    expect(deletion.abort()).toBe(true);
    const currentDeletion = service.beginAppDeletion(7);
    expect(deletion.abort()).toBe(false);
    expect(currentDeletion.abort()).toBe(true);
    await expect(
      actorA.dispatch({
        type: "START",
        operationId: "after-abort",
        startedAt: 20,
        expectedRevision: actorA.getSnapshot().revision,
      }),
    ).resolves.toMatchObject({ kind: "applied" });
  });

  it("drains an already-locked external restart before reset sealing", async () => {
    const { host } = createHarness();
    const service = new AppRunActorService(host);
    const entered = deferred<void>();
    const pending = deferred<number>();
    const restart = service.executeAlreadyLockedExternalRestart(7, async () => {
      entered.resolve();
      return pending.promise;
    });
    await entered.promise;

    const reset = service.beginReset();
    let sealed = false;
    const sealing = reset.seal().then(() => {
      sealed = true;
    });
    await flush();
    expect(sealed).toBe(false);

    pending.resolve(42);
    await expect(restart).resolves.toBe(42);
    await sealing;
    expect(reset.commit()).toBe(true);
    expect(reset.release()).toBe(true);
  });

  it("can fence a normally completed run without untracked command work", async () => {
    const { duplex, host } = createHarness();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );
    manager.start();
    await manager.dispatch(7, { type: "START", startedAt: 10 });

    const deletion = new AppRunActorService(host).beginAppDeletion(7);
    expect(deletion.abort()).toBe(true);
    manager.dispose();
  });

  it("stops a running app from a fresh unbootstrapped renderer actor", async () => {
    const { actorA, duplex } = createHarness();
    await actorA.resync();
    await actorA.dispatch({
      type: "START",
      operationId: "existing-run",
      startedAt: 10,
      expectedRevision: actorA.getSnapshot().revision,
    });
    await flush();
    const manager = new AppRunRemoteManager(
      createSequentialIdSource(),
      duplex.connect(),
    );

    await manager.dispatch(7, { type: "STOP", startedAt: 20 });

    expect(runtime.stop).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it("keeps successful deletion fenced through final actor cleanup", async () => {
    const { host } = createHarness();
    const service = new AppRunActorService(host);
    service.actor(7);
    const deletion = service.beginAppDeletion(7);

    await deletion.seal();
    expect(deletion.commit()).toBe(true);
    await service.disposeApp(7);
    expect(() => service.actor(7)).toThrow(
      expect.objectContaining({ code: "key-fenced" }),
    );
    expect(deletion.release()).toBe(true);
  });

  it("drops late output without recreating or reaching a replacement actor", async () => {
    const { host } = createHarness();
    const service = new AppRunActorService(host);
    service.actor(7);
    const oldOutput = service.outputFor(7, {
      kind: "app-run",
      entityKey: 7,
      operationId: "old-runtime",
    });

    await service.disposeApp(7);
    const replacement = service.actor(7);
    oldOutput.enqueue({
      type: "stdout",
      appId: 7,
      message:
        "[dyad-proxy-server]started=[http://localhost:3210] original=[http://localhost:5173] mode=[host]",
    });
    oldOutput.send({
      type: "app-exit",
      appId: 7,
      message: "late exit",
      exitCode: 1,
      timestamp: 30,
    });
    await flush();

    expect(host.peek(appRunDefinition.id, appRunKey(7))).toBe(replacement);
    expect(replacement.getSnapshot().runState).toEqual({ type: "idle" });
  });

  it("accepts current-process output after an unrelated actor revision", async () => {
    const { host } = createHarness();
    const service = new AppRunActorService(host);
    await service.dispatchStart(7, {
      operationId: "current-runtime",
      startedAt: 10,
    });
    const actor = service.actor(7);
    const output = service.outputFor(7, {
      kind: "app-run",
      entityKey: 7,
      operationId: "current-runtime",
    });
    await actor.enqueue({
      type: "MANUAL_RELOAD",
      operationId: "reload-current-runtime",
      startedAt: 20,
    }).settled;

    output.send({
      type: "app-exit",
      appId: 7,
      message: "current process exited",
      exitCode: 1,
      timestamp: 30,
    });
    await flush();

    expect(actor.getSnapshot()).toMatchObject({
      runState: { type: "stopped", timestamp: 30 },
    });
  });
});
