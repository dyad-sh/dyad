import { describe, expect, it } from "vitest";
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
        emit({ type: "RELOAD_DONE", runId: command.runId });
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

describe("AppRunController", () => {
  it("allocates a fresh runId per operation and drops stale completions", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    const firstRunId = lastStartCommand(executor).runId;
    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      operation: "run",
      runId: firstRunId,
    });

    void controller.dispatch({
      type: "RESTART",
      startedAt: 150,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await flushMicrotasks();
    const secondRunId = lastStartCommand(executor).runId;
    expect(secondRunId).not.toBe(firstRunId);
    const restarting = controller.getSnapshot();
    expect(restarting).toMatchObject({
      type: "starting",
      operation: "restart",
      runId: secondRunId,
    });

    // The superseded run's IPC resolution must not advance the machine.
    executor.emit({ type: "RUN_IPC_RESOLVED", runId: firstRunId });
    expect(controller.getSnapshot()).toBe(restarting);

    // The current operation's resolution does.
    executor.emit({ type: "RUN_IPC_RESOLVED", runId: secondRunId });
    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      runId: secondRunId,
    });
  });

  it("settles dispatch promises when their IPC settles, even when superseded", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });

    let firstSettled = false;
    let secondSettled = false;
    const first = controller
      .dispatch({ type: "START", startedAt: 100 })
      .then(() => {
        firstSettled = true;
      });
    await flushMicrotasks();
    const firstRunId = lastStartCommand(executor).runId;

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
    const secondRunId = lastStartCommand(executor).runId;

    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    executor.emit({ type: "RUN_IPC_RESOLVED", runId: firstRunId });
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
      runId: secondRunId,
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
    const controller = new AppRunController({ appId: APP_ID, executor });

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

  it("stamps PROXY_READY with the current epoch and re-establishes ready from idle", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });

    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
    expect(controller.getSnapshot()).toMatchObject({
      type: "ready",
      appId: APP_ID,
      url: makeUrl(1),
    });
    await flushMicrotasks();
    expect(executor.executed).toContainEqual({
      type: "applyUrl",
      appId: APP_ID,
      url: makeUrl(1),
    });
  });

  it("buffers a proxy line during starting and applies it at IPC resolution", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    const runId = lastStartCommand(executor).runId;

    controller.send({ type: "PROXY_READY", url: makeUrl(2) });
    expect(controller.getSnapshot()).toMatchObject({
      type: "starting",
      pendingUrl: makeUrl(2),
    });
    expect(executor.executed.filter((c) => c.type === "applyUrl")).toHaveLength(
      0,
    );

    executor.emit({ type: "RUN_IPC_RESOLVED", runId });
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

  it("runs the HMR reload cycle and drops RELOAD_DONE after a new operation", async () => {
    const executor = createFakeExecutor({ autoCompleteReloads: false });
    const controller = new AppRunController({ appId: APP_ID, executor });
    const seen: RunState[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot()));

    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
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
    executor.emit({ type: "RELOAD_DONE", runId: reload.runId });
    expect(controller.getSnapshot()).toBe(restarting);

    expect(seen.map((state) => state.type)).toEqual([
      "ready",
      "reloading",
      "starting",
    ]);
  });

  it("completes the reload cycle back to ready when not superseded", async () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });

    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
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
      executor,
      onStateChange: (state) => published.push(state),
    });

    void controller.dispatch({ type: "START", startedAt: 100 });
    await flushMicrotasks();
    executor.emit({
      type: "RUN_IPC_RESOLVED",
      runId: lastStartCommand(executor).runId,
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
    const controller = new AppRunController({ appId: APP_ID, executor });

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
    const executor: RunCommandExecutor = {
      async execute(command) {
        executed.push(command.type);
      },
    };
    let reacted = false;
    const controller = new AppRunController({
      appId: APP_ID,
      executor,
      onStateChange: (state) => {
        if (state.type === "ready" && !reacted) {
          reacted = true;
          controller.send({ type: "MANUAL_RELOAD" });
        }
      },
    });

    // idle -> ready via proxy line; onStateChange immediately requests a
    // manual reload. applyUrl (outer) must execute before reload (inner).
    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
    await flushMicrotasks();

    expect(executed).toEqual(["applyUrl", "reload"]);
  });

  it("supports unsubscribe", () => {
    const executor = createFakeExecutor();
    const controller = new AppRunController({ appId: APP_ID, executor });
    let notified = 0;
    const unsubscribe = controller.subscribe(() => notified++);

    controller.send({ type: "PROXY_READY", url: makeUrl(1) });
    expect(notified).toBe(1);

    unsubscribe();
    controller.send({ type: "HMR_DETECTED" });
    expect(notified).toBe(1);
  });
});
