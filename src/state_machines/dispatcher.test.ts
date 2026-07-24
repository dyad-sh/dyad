import { describe, expect, it, vi } from "vitest";
import { TransactionalDispatcher, type DispatcherError } from "./dispatcher";
import {
  runControllerConformanceSuite,
  type ControllerConformanceAdapter,
} from "./testing";
import { change, ignore, stay, type TransitionResult } from "./types";

type TestState = { value: number };
type TestCommand =
  | { type: "emit"; event: TestEvent }
  | { type: "sync-throw" }
  | { type: "async-reject" }
  | { type: "deferred"; id: number }
  | { type: "cleanup"; state: number };
type TestEvent =
  | { type: "SET"; value: number }
  | { type: "FINISH" }
  | { type: "COMMAND"; command: TestCommand }
  | { type: "IGNORE" };
type TestReason = "ignored";

function testTransition(
  state: TestState,
  event: TestEvent,
): TransitionResult<TestState, TestCommand, TestReason> {
  switch (event.type) {
    case "SET":
      return state.value === event.value
        ? stay(state, [])
        : change({ value: event.value });
    case "COMMAND":
      return stay(state, [event.command]);
    case "FINISH":
      return change({ value: 99 });
    case "IGNORE":
      return ignore(state, "ignored");
  }
}

function independentScheduler() {
  return {
    schedule(
      batch: { commands: readonly TestCommand[] },
      execute: (command: TestCommand) => Promise<void>,
    ) {
      for (const command of batch.commands) void execute(command);
    },
  };
}

function createConformanceAdapter(): ControllerConformanceAdapter<
  TestState,
  TestEvent,
  TestCommand,
  TestReason
> {
  let deferredId = 0;
  return {
    initialState: { value: 0 },
    transition: testTransition,
    create(options) {
      const dispatcher = new TransactionalDispatcher({
        initialState: { value: 0 },
        transition: testTransition,
        runCommand(command, emit) {
          if (command.type === "emit") emit(command.event);
          return options.runCommand(command, emit);
        },
        scheduler: independentScheduler(),
        observer: options.observer,
        beforeCommit: options.beforeCommit,
        project: options.project,
        reportError: options.reportError,
      });
      let disposed = false;
      return {
        getSnapshot: dispatcher.getSnapshot,
        subscribe: dispatcher.subscribe,
        send: dispatcher.send,
        dispose() {
          if (disposed) return;
          disposed = true;
          const state = dispatcher.getSnapshot();
          dispatcher.dispose();
          options.cleanupProjection?.();
          const commands = options.disposeCommands?.(state) ?? [];
          dispatcher.startFinalizers(commands);
          options.releaseWriter?.();
          options.onDisposed?.();
        },
      };
    },
    events: {
      enterA: { type: "SET", value: 1 },
      enterB: { type: "SET", value: 2 },
      finish: { type: "FINISH" },
      command: (command) => ({ type: "COMMAND", command }),
    },
    errorStage: (error) => (error as DispatcherError<TestCommand>).stage,
    commands: {
      emit: (event) => ({ type: "emit", event }),
      syncThrow: { type: "sync-throw" },
      asyncReject: { type: "async-reject" },
      awaitThen() {
        return {
          command: { type: "deferred", id: deferredId++ },
          resolve: () => undefined,
        };
      },
      cleanup: (state) => [{ type: "cleanup", state: state.value }],
    },
    nonTerminalEvents: [
      { name: "initial", event: { type: "IGNORE" } },
      { name: "A", event: { type: "SET", value: 1 } },
      { name: "B", event: { type: "SET", value: 2 } },
      { name: "finished-work", event: { type: "FINISH" } },
    ],
    stateKey: (state) => String(state.value),
  };
}

describe("TransactionalDispatcher", () => {
  it("runs the transaction in commit, projection, subscriber, observer, command order", () => {
    const order: string[] = [];
    let dispatcher: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition(state, event) {
        order.push(`transition:${state.value}:${event.type}`);
        if (event.type === "SET") {
          return change(
            { value: event.value },
            event.value === 1
              ? [{ type: "emit", event: { type: "SET", value: 2 } }]
              : [],
          );
        }
        return testTransition(state, event);
      },
      beforeCommit(previous, next) {
        order.push(`before:${previous.value}->${next.value}`);
      },
      project(snapshot) {
        order.push(
          `project:${snapshot.value}:${dispatcher.getSnapshot().value}`,
        );
      },
      observer: {
        onTransitionApplied({ state }) {
          order.push(
            `observer:${state.value}:${dispatcher.getSnapshot().value}`,
          );
        },
      },
      scheduler: {
        schedule(batch, execute) {
          order.push(`schedule:${batch.sequence}`);
          for (const command of batch.commands) void execute(command);
        },
      },
      runCommand(command, emit) {
        order.push(`command:${command.type}`);
        if (command.type === "emit") emit(command.event);
      },
    });
    dispatcher.subscribe(() => {
      order.push(`subscriber:${dispatcher.getSnapshot().value}`);
    });

    dispatcher.send({ type: "SET", value: 1 });

    expect(order).toEqual([
      "transition:0:SET",
      "before:0->1",
      "project:1:1",
      "subscriber:1",
      "observer:1:1",
      "schedule:1",
      "command:emit",
      "transition:1:SET",
      "before:1->2",
      "project:2:2",
      "subscriber:2",
      "observer:2:2",
      "schedule:2",
    ]);
  });

  it("observes ignored events at the observer point without committing or scheduling", () => {
    const project = vi.fn();
    const subscriber = vi.fn();
    const schedule = vi.fn();
    const observer = vi.fn();
    const initial = { value: 0 };
    const dispatcher = new TransactionalDispatcher({
      initialState: initial,
      transition: testTransition,
      project,
      observer: { onEventIgnored: observer },
      scheduler: { schedule },
      runCommand: () => undefined,
    });
    dispatcher.subscribe(subscriber);

    dispatcher.send({ type: "IGNORE" });

    expect(dispatcher.getSnapshot()).toBe(initial);
    expect(project).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(observer).toHaveBeenCalledWith({
      state: initial,
      event: { type: "IGNORE" },
      reason: "ignored",
    });
  });

  it("isolates callback failures and continues the FIFO", () => {
    const stages: string[] = [];
    const observed: number[] = [];
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      project() {
        throw new Error("projection");
      },
      observer: {
        onTransitionApplied({ state }) {
          observed.push(state.value);
          throw new Error("observer");
        },
      },
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      reportError: (failure) => stages.push(failure.stage),
    });
    dispatcher.subscribe(() => {
      throw new Error("subscriber");
    });

    dispatcher.send({ type: "SET", value: 1 });
    dispatcher.send({ type: "SET", value: 2 });

    expect(dispatcher.getSnapshot()).toEqual({ value: 2 });
    expect(observed).toEqual([1, 2]);
    expect(stages).toEqual([
      "projection",
      "subscriber",
      "observer",
      "projection",
      "subscriber",
      "observer",
    ]);
  });

  it("reports command failures, maps them through domain events, and does not wedge", async () => {
    const failures: string[] = [];
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand(command) {
        if (command.type === "sync-throw") throw new Error("boom");
        if (command.type === "async-reject") {
          return Promise.reject(new Error("later boom"));
        }
      },
      mapUnexpectedCommandError: () =>
        ({ type: "SET", value: 7 }) satisfies TestEvent,
      reportError: (failure) => failures.push(failure.stage),
    });

    dispatcher.send({
      type: "COMMAND",
      command: { type: "sync-throw" },
    });
    dispatcher.send({
      type: "COMMAND",
      command: { type: "async-reject" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(failures).toEqual(["command", "command"]);
    expect(dispatcher.getSnapshot()).toEqual({ value: 7 });
  });

  it("does not let a deferred scheduler start normal commands after disposal", async () => {
    let deferredStart: (() => Promise<void>) | undefined;
    const runCommand = vi.fn();
    const command: TestCommand = { type: "cleanup", state: 1 };
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: {
        schedule(batch, execute) {
          deferredStart = () => execute(batch.commands[0]);
        },
      },
      runCommand,
    });
    dispatcher.send({ type: "COMMAND", command });

    dispatcher.dispose();
    await deferredStart?.();

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("passes the reusable adversarial conformance suite", async () => {
    const adapter = createConformanceAdapter();
    const originalCreate = adapter.create;
    adapter.create = (options) =>
      originalCreate({
        ...options,
        runCommand(command, emit) {
          if (command.type === "sync-throw") {
            throw new Error("conformance sync throw");
          }
          if (command.type === "async-reject") {
            return Promise.reject(new Error("conformance async rejection"));
          }
          return options.runCommand(command, emit);
        },
      });
    await expect(
      runControllerConformanceSuite(adapter),
    ).resolves.toBeUndefined();
  });

  it("fails meaningfully against an observer-before-commit reference", async () => {
    const adapter = createConformanceAdapter();
    adapter.create = (options) => {
      let state = adapter.initialState;
      let disposed = false;
      const listeners = new Set<() => void>();
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(event) {
          if (disposed) return;
          const previous = state;
          const result = adapter.transition(previous, event);
          if (result.kind === "ignored") return;
          options.observer?.onTransitionApplied?.({
            previous,
            event,
            state: result.state,
            commands: result.commands,
          });
          state = result.state;
          for (const listener of listeners) listener();
        },
        dispose() {
          disposed = true;
        },
      };
    };

    await expect(runControllerConformanceSuite(adapter)).rejects.toThrow(
      "re-entrant observer dispatch",
    );
  });

  it("fails lifecycle conformance when writer release precedes projection cleanup", async () => {
    const adapter = createConformanceAdapter();
    const originalCreate = adapter.create;
    adapter.create = (options) =>
      originalCreate({
        ...options,
        cleanupProjection: options.releaseWriter,
        releaseWriter: options.cleanupProjection,
      });

    await expect(runControllerConformanceSuite(adapter)).rejects.toThrow(
      "projection cleanup before writer release",
    );
  });
});
