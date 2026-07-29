import { describe, expect, it, vi } from "vitest";
import { TransactionalDispatcher, type DispatcherError } from "./dispatcher";
import {
  runControllerConformanceSuite,
  type ControllerConformanceAdapter,
} from "./testing";
import {
  change,
  ignore,
  stay,
  type DispatchContext,
  type TransitionResult,
} from "./types";

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
  it("passes dispatch context to applied and ignored observers", async () => {
    const applied = vi.fn();
    const ignored = vi.fn();
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      observer: {
        onTransitionApplied: applied,
        onEventIgnored: ignored,
      },
    });
    const context: DispatchContext = {
      messageId: "message-1",
      correlationId: "correlation-1",
      causationId: "causation-1",
    };

    await dispatcher.enqueue({ type: "SET", value: 1 }, undefined, context)
      .settled;
    await dispatcher.enqueue({ type: "IGNORE" }, undefined, context).settled;

    expect(applied).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchContext: context }),
    );
    expect(ignored).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchContext: context }),
    );
  });

  it("settles re-entrant enqueue tickets on their exact FIFO turns", async () => {
    const tickets: ReturnType<
      TransactionalDispatcher<
        TestState,
        TestEvent,
        TestCommand,
        TestReason
      >["enqueue"]
    >[] = [];
    let dispatcher: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      observer: {
        onTransitionApplied({ state }) {
          if (state.value === 1) {
            tickets.push(dispatcher.enqueue({ type: "IGNORE" }));
            tickets.push(dispatcher.enqueue({ type: "SET", value: 2 }));
          }
        },
      },
    });

    const first = dispatcher.enqueue({ type: "SET", value: 1 });
    await expect(first.settled).resolves.toEqual({
      kind: "applied",
      state: { value: 1 },
    });
    await expect(tickets[0].settled).resolves.toEqual({
      kind: "ignored",
      state: { value: 1 },
      reason: "ignored",
    });
    await expect(tickets[1].settled).resolves.toEqual({
      kind: "applied",
      state: { value: 2 },
    });
  });

  it("settles transition and validation failures without wedging later entries", async () => {
    const transitionError = new Error("bad event");
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition(state, event: TestEvent) {
        if (event.type === "IGNORE") throw transitionError;
        if (event.type === "SET" && event.value === 1) {
          return change({ value: state.value });
        }
        return testTransition(state, event);
      },
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      reportError: () => undefined,
    });

    const failedTransition = dispatcher.enqueue({ type: "IGNORE" });
    const failedValidation = dispatcher.enqueue({ type: "SET", value: 1 });
    const applied = dispatcher.enqueue({ type: "SET", value: 2 });

    await expect(failedTransition.settled).resolves.toEqual({
      kind: "failed",
      stage: "transition",
      error: transitionError,
    });
    await expect(failedValidation.settled).resolves.toMatchObject({
      kind: "failed",
      stage: "validation",
    });
    await expect(applied.settled).resolves.toEqual({
      kind: "applied",
      state: { value: 2 },
    });
  });

  it("settles queued work as disposed when disposal occurs re-entrantly", async () => {
    let queued:
      | ReturnType<
          TransactionalDispatcher<
            TestState,
            TestEvent,
            TestCommand,
            TestReason
          >["enqueue"]
        >
      | undefined;
    let dispatcher: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      observer: {
        onTransitionApplied() {
          queued = dispatcher.enqueue({ type: "SET", value: 2 });
          dispatcher.dispose();
        },
      },
    });

    const committed = dispatcher.enqueue({ type: "SET", value: 1 });

    await expect(committed.settled).resolves.toEqual({
      kind: "applied",
      state: { value: 1 },
    });
    await expect(queued?.settled).resolves.toEqual({ kind: "disposed" });
    await expect(
      dispatcher.enqueue({ type: "SET", value: 3 }).settled,
    ).resolves.toEqual({ kind: "disposed" });
  });

  it("settles the current ticket as disposed when beforeCommit closes admission", async () => {
    const project = vi.fn();
    const observer = vi.fn();
    const schedule = vi.fn();
    let dispatcher!: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      beforeCommit() {
        dispatcher.dispose();
      },
      project,
      observer: { onTransitionApplied: observer },
      scheduler: { schedule },
      runCommand: () => undefined,
    });

    const ticket = dispatcher.enqueue({ type: "SET", value: 1 });

    await expect(ticket.settled).resolves.toEqual({ kind: "disposed" });
    expect(dispatcher.getSnapshot()).toEqual({ value: 0 });
    expect(project).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("preserves ticket settlement order during re-entrant admission shutdown", async () => {
    const settlementOrder: string[] = [];
    let dispatcher: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => undefined,
      observer: {
        onTransitionApplied({ state }) {
          if (state.value === 1) {
            const current = dispatcher.enqueue({ type: "SET", value: 2 });
            void current.settled.then(() => settlementOrder.push("current"));
          } else if (state.value === 2) {
            const queued = dispatcher.enqueue({ type: "SET", value: 3 });
            void queued.settled.then(() => settlementOrder.push("queued"));
            dispatcher.stopAdmission();
          }
        },
      },
    });

    dispatcher.send({ type: "SET", value: 1 });
    await Promise.resolve();

    expect(settlementOrder).toEqual(["current", "queued"]);
  });

  it("can stop admission before final snapshot and subscriber disposal", async () => {
    const subscriber = vi.fn();
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => undefined,
    });
    const unsubscribe = dispatcher.subscribe(subscriber);

    dispatcher.stopAdmission();

    expect(dispatcher.getSnapshot()).toEqual({ value: 0 });
    expect(dispatcher.isAccepting()).toBe(false);
    await expect(
      dispatcher.enqueue({ type: "SET", value: 1 }).settled,
    ).resolves.toEqual({ kind: "disposed" });
    unsubscribe();
    dispatcher.dispose();
    expect(dispatcher.isDisposed()).toBe(true);
  });

  it("keeps an applied ticket applied when its command later fails", async () => {
    const commandError = new Error("command failed");
    const dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: testTransition,
      scheduler: independentScheduler(),
      runCommand: () => Promise.reject(commandError),
      reportError: () => undefined,
    });

    const ticket = dispatcher.enqueue({
      type: "COMMAND",
      command: { type: "async-reject" },
    });

    await expect(ticket.settled).resolves.toEqual({
      kind: "applied",
      state: { value: 0 },
    });
  });

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

  it("publishes explicit outcomes only after commit and before scheduler handoff", () => {
    const observed: string[] = [];
    let dispatcher!: TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason,
      { readonly requestId: string }
    >;
    dispatcher = new TransactionalDispatcher({
      initialState: { value: 0 },
      transition: (state, event) =>
        event.type === "SET"
          ? change({ value: event.value }, [], [{ requestId: "request-one" }])
          : ignore(state, "ignored"),
      runCommand: () => undefined,
      scheduler: {
        schedule() {
          observed.push(`scheduler:${dispatcher.getSnapshot().value}`);
        },
      },
      observer: {
        onTransitionApplied() {
          observed.push(`observer:${dispatcher.getSnapshot().value}`);
        },
      },
      publishOutcome() {
        observed.push(`outcome:${dispatcher.getSnapshot().value}`);
        dispatcher.send({ type: "IGNORE" });
      },
    });

    dispatcher.send({ type: "SET", value: 7 });

    expect(observed).toEqual(["observer:7", "outcome:7", "scheduler:7"]);
  });

  it("isolates post-commit outcome callback failures", async () => {
    const errors: DispatcherError[] = [];
    const dispatcher = new TransactionalDispatcher<
      TestState,
      TestEvent,
      TestCommand,
      TestReason,
      string
    >({
      initialState: { value: 0 },
      transition: (state, event) =>
        event.type === "SET"
          ? change({ value: event.value }, [], ["terminal"])
          : ignore(state, "ignored"),
      runCommand: () => undefined,
      scheduler: independentScheduler(),
      publishOutcome() {
        throw new Error("presentation failed");
      },
      reportError: (error) => errors.push(error),
    });

    const ticket = dispatcher.enqueue({ type: "SET", value: 3 });

    await expect(ticket.settled).resolves.toMatchObject({ kind: "applied" });
    expect(dispatcher.getSnapshot()).toEqual({ value: 3 });
    expect(errors).toMatchObject([{ stage: "outcome" }]);
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
