import { describe, expect, it } from "vitest";
import { createSequentialIdSource } from "@/state_machines/testing";
import type { RunCommandExecutor, RunEventSink } from "./commands";
import { AppRunController } from "./controller";
import type { RunCommand, RunState, RunUrl } from "./state";

const APP_ID = 7;

function makeUrl(n: number): RunUrl {
  return {
    appUrl: `http://localhost:4210${n}`,
    originalUrl: `http://localhost:3210${n}`,
    mode: "host",
  };
}

interface FakeExecutor extends RunCommandExecutor {
  executed: RunCommand[];
  emit: RunEventSink;
}

/**
 * Records commands without performing them. IPC settlement is driven
 * manually from the tests via the captured `emit`, standing in for the
 * detached promise callbacks of the real adapter.
 */
function createFakeExecutor({
  autoCompleteReloads = true,
}: { autoCompleteReloads?: boolean } = {}): FakeExecutor {
  const fake: FakeExecutor = {
    executed: [],
    emit: () => {
      throw new Error("emit captured before any command executed");
    },
    async execute(command, emit) {
      fake.executed.push(command);
      fake.emit = emit;
      if (autoCompleteReloads && command.type === "reload") {
        emit({ type: "RELOAD_DONE", invocationRef: command.invocationRef });
      }
    },
  };
  return fake;
}

function lastStartCommand(executor: FakeExecutor) {
  const command = [...executor.executed]
    .reverse()
    .find((c) => c.type === "start");
  if (!command || command.type !== "start") {
    throw new Error("no start command executed");
  }
  return command;
}

async function flushMicrotasks() {
  // Two turns: one for the queue promise, one for chained continuations.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function makeReady(
  controller: AppRunController,
  executor: FakeExecutor,
  url = makeUrl(1),
) {
  void controller.dispatch({ type: "START", startedAt: 100 });
  await flushMicrotasks();
  const invocationRef = lastStartCommand(executor).invocationRef;
  controller.send({ type: "PROXY_READY", invocationRef, url });
  executor.emit({ type: "RUN_IPC_RESOLVED", invocationRef });
  await flushMicrotasks();
  return invocationRef;
}

describe("AppRunController", () => {
  it("tracks an external restart through its invocation without issuing start", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    controller.beginExternal({
      requestId: "agent-restart-1",
      operation: "restart",
      startedAt: 100,
    });
    await flushMicrotasks();

    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      operation: "restart",
    });
    expect(executor.executed).toEqual([
      {
        type: "prepareExternalStart",
        appId: APP_ID,
        operation: "restart",
      },
    ]);

    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
    controller.settleExternal("agent-restart-1");
    await flushMicrotasks();

    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      url: makeUrl(1),
    });
    expect(executor.executed.some((command) => command.type === "start")).toBe(
      false,
    );
  });

  it("allocates a fresh invocationRef per operation and drops stale completions", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    const firstInvocationRef = lastStartCommand(executor).invocationRef;
    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      operation: "run",
      invocationRef: firstInvocationRef,
    });

    void controller.dispatch({
      type: "RESTART",
      startedAt: 150,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await flushMicrotasks();
    const secondInvocationRef = lastStartCommand(executor).invocationRef;
    expect(secondInvocationRef).not.toBe(firstInvocationRef);
    const restarting = controller.getSnapshot();
    expect(restarting).toMatchObject({
      type: "starting",
      operation: "restart",
      invocationRef: secondInvocationRef,
    });

    // The superseded run's IPC resolution must not advance the machine.
    executor.emit({
      type: "RUN_IPC_RESOLVED",
      invocationRef: firstInvocationRef,
    });
    expect(controller.getSnapshot()).toBe(restarting);

    // The current operation's resolution does.
    executor.emit({
      type: "RUN_IPC_RESOLVED",
      invocationRef: secondInvocationRef,
    });
    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      invocationRef: secondInvocationRef,
    });
  });

  it("keeps the producer ref when START only ensures a ready app is running", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });
    const producerRef = await makeReady(controller, executor);

    const ensured = controller.dispatch({ type: "START", startedAt: 200 });
    await flushMicrotasks();
    expect(lastStartCommand(executor).invocationRef).toEqual(producerRef);

    controller.send({
      type: "PROXY_READY",
      invocationRef: producerRef,
      url: makeUrl(2),
    });
    executor.emit({
      type: "RUN_IPC_RESOLVED",
      invocationRef: producerRef,
    });
    await ensured;

    controller.send({
      type: "APP_EXIT",
      invocationRef: producerRef,
      exitCode: 1,
      timestamp: 300,
    });
    expect(controller.getSnapshot()).toMatchObject({
      type: "stopped",
      invocationRef: producerRef,
      exitCode: 1,
    });
  });

  it("settles dispatch promises when their IPC settles, even when superseded", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    let firstSettled = false;
    let secondSettled = false;
    const first = controller
      .dispatch({ type: "START", startedAt: 100 })
      .then(() => {
        firstSettled = true;
      });
    await flushMicrotasks();
    const firstInvocationRef = lastStartCommand(executor).invocationRef;

    const second = controller
      .dispatch({
        type: "RESTART",
        startedAt: 150,
        options: { removeNodeModules: false, recreateSandbox: false },
      })
      .then(() => {
        secondSettled = true;
      });
    await flushMicrotasks();
    const secondInvocationRef = lastStartCommand(executor).invocationRef;

    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    executor.emit({
      type: "RUN_IPC_RESOLVED",
      invocationRef: firstInvocationRef,
    });
    await first;
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(false);
    // ...while the machine still reflects the newer restart.
    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      operation: "restart",
    });

    executor.emit({
      type: "RUN_IPC_FAILED",
      invocationRef: secondInvocationRef,
      error: { message: "boom" },
    });
    await second;
    expect(secondSettled).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ type: "errored" });
  });

  it("executes commands serially per app", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let executions = 0;
    const executor: RunCommandExecutor = {
      async execute(command) {
        executions++;
        order.push(`begin:${command.type}:${executions}`);
        if (executions === 1) {
          await gate;
        }
        order.push(`end:${command.type}:${executions}`);
      },
    };
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    void controller.dispatch({ type: "STOP", startedAt: 150 });
    await flushMicrotasks();

    // The second operation's command must wait for the first to finish.
    expect(order).toEqual(["begin:start:1"]);

    releaseFirst();
    await flushMicrotasks();
    expect(order).toEqual([
      "begin:start:1",
      "end:start:1",
      "begin:stop:2",
      "end:stop:2",
    ]);
  });

  it("ignores a tagged late producer when no invocation is active", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });
    const oldRef = {
      kind: "app-run",
      entityKey: APP_ID,
      operationId: "app-run:disposed",
    } as const;

    controller.send({
      type: "PROXY_READY",
      invocationRef: oldRef,
      url: makeUrl(1),
    });
    expect(controller.getSnapshot()).toEqual({ type: "idle" });
    await flushMicrotasks();
    expect(executor.executed).toEqual([]);
  });

  it("buffers a proxy line during starting and applies it at IPC resolution", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    const invocationRef = lastStartCommand(executor).invocationRef;

    controller.send({ type: "PROXY_READY", url: makeUrl(2) });
    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      pendingUrl: makeUrl(2),
    });
    expect(executor.executed.filter((c) => c.type === "applyUrl")).toHaveLength(
      0,
    );

    executor.emit({ type: "RUN_IPC_RESOLVED", invocationRef });
    await flushMicrotasks();
    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      url: makeUrl(2),
    });
    expect(executor.executed).toContainEqual({
      type: "applyUrl",
      appId: APP_ID,
      url: makeUrl(2),
    });
  });

  it("does not apply a buffered stale proxy URL when a restart fails", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    void controller.dispatch({
      type: "RESTART",
      startedAt: 100,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await flushMicrotasks();
    const invocationRef = lastStartCommand(executor).invocationRef;

    controller.send({ type: "PROXY_READY", url: makeUrl(2) });
    executor.emit({
      type: "RUN_IPC_FAILED",
      invocationRef,
      error: { message: "restart failed" },
    });
    await flushMicrotasks();

    expect(controller.getSnapshot()).toMatchObject({
      type: "errored",
      error: { message: "restart failed" },
    });
    expect(executor.executed).toContainEqual({
      type: "setError",
      appId: APP_ID,
      error: { message: "restart failed" },
    });
    expect(executor.executed).toContainEqual({
      type: "bumpReloadToken",
      appId: APP_ID,
    });
    expect(executor.executed.filter((c) => c.type === "applyUrl")).toEqual([]);
  });

  it("runs the HMR reload cycle and drops RELOAD_DONE after a new operation", async () => {
    const executor = createFakeExecutor({ autoCompleteReloads: false });
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });
    const seen: RunState[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot()));

    await makeReady(controller, executor);
    seen.length = 0;
    controller.send({ type: "HMR_DETECTED" });
    expect(controller.getSnapshot()).toMatchObject({
      type: "reloading",
      reason: "hmr",
    });
    await flushMicrotasks();
    const reload = executor.executed.find((c) => c.type === "reload");
    if (!reload || reload.type !== "reload") {
      throw new Error("expected a reload command");
    }

    // A restart supersedes the reload before it completes...
    void controller.dispatch({
      type: "RESTART",
      startedAt: 150,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    const restarting = controller.getSnapshot();
    expect(restarting).toMatchObject({ type: "starting" });

    // ...so its stale completion must be dropped.
    executor.emit({ type: "RELOAD_DONE", invocationRef: reload.invocationRef });
    expect(controller.getSnapshot()).toBe(restarting);

    expect(seen.map((state) => state.type)).toEqual(["reloading", "starting"]);
  });

  it("completes the reload cycle back to ready when not superseded", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    await makeReady(controller, executor);
    controller.send({ type: "MANUAL_RELOAD" });
    await flushMicrotasks();
    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      url: makeUrl(1),
    });
  });

  it("publishes every state change through onStateChange", async () => {
    const executor = createFakeExecutor();
    const published: RunState[] = [];
    const controller = new AppRunController({
      appId: APP_ID,
      idSource: createSequentialIdSource(),
      executor,
      onStateChange: (state) => published.push(state),
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    executor.emit({
      type: "RUN_IPC_RESOLVED",
      invocationRef: lastStartCommand(executor).invocationRef,
    });

    expect(published.map((state) => state.type)).toEqual(["starting", "ready"]);
  });

  it("keeps command order when a listener re-entrantly dispatches", async () => {
    const executed: string[] = [];
    const executor: RunCommandExecutor = {
      async execute(command) {
        executed.push(command.type);
      },
    };
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });

    const seen: string[] = [];
    let reacted = false;
    controller.subscribe(() => {
      const state = controller.getSnapshot();
      seen.push(state.type);
      // A listener reacting to `starting` by synchronously dispatching a
      // stop. Its commands must land AFTER the outer event's commands.
      if (state.type === "starting" && !reacted) {
        reacted = true;
        void controller.dispatch({ type: "STOP", startedAt: 150 });
      }
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();

    expect(seen).toEqual(["starting", "stopping"]);
    expect(executed).toEqual(["start", "stop"]);
    expect(controller.getSnapshot()).toMatchObject({ type: "stopping" });
  });

  it("keeps command order when onStateChange re-entrantly sends", async () => {
    const executed: string[] = [];
    const executor: FakeExecutor = {
      executed: [],
      emit: () => {
        throw new Error("emit captured before execution");
      },
      async execute(command, emit) {
        executor.executed.push(command);
        executor.emit = emit;
        executed.push(command.type);
      },
    };
    let reacted = false;
    const controller = new AppRunController({
      appId: APP_ID,
      idSource: createSequentialIdSource(),
      executor,
      onStateChange: (state) => {
        if (state.type === "ready" && !reacted) {
          reacted = true;
          controller.send({ type: "MANUAL_RELOAD" });
        }
      },
    });

    // The ready transition publishes its URL commands before onStateChange
    // re-entrantly requests a manual reload.
    await makeReady(controller, executor);
    await flushMicrotasks();

    expect(executed.slice(-3)).toEqual(["clearError", "applyUrl", "reload"]);
  });

  it("supports unsubscribe", () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      idSource: createSequentialIdSource(),
    });
    let notified = 0;
    const unsubscribe = controller.subscribe(() => notified++);

    void controller.dispatch({ type: "START", startedAt: 100 });
    expect(notified).toBe(1);

    unsubscribe();
    controller.send({ type: "HMR_DETECTED" });
    expect(notified).toBe(1);
  });
});
