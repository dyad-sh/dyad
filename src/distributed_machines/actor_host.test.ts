import { describe, expect, it, vi } from "vitest";
import { change, ignore, stay } from "@/state_machines/types";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import {
  ActorAdmissionError,
  ActorHost,
  type ActorHostError,
} from "./actor_host";
import type {
  ActorLifecyclePolicy,
  DistributedMachineDefinition,
} from "./definition";
import { runLocalActorHostConformanceSuite } from "./testing";

type State = {
  readonly value: number;
  readonly terminal?: boolean;
};
type Event =
  | { readonly type: "SET"; readonly value: number }
  | { readonly type: "IGNORE" }
  | { readonly type: "COMMAND" }
  | { readonly type: "TERMINAL" };
type Command = { readonly type: "NOOP" };
type Reason = "ignored";

function lifecycle(
  overrides: Partial<ActorLifecyclePolicy<string, State>> = {},
): ActorLifecyclePolicy<string, State> {
  return {
    subscriptionCreates: true,
    dispatchCreates: true,
    idleEviction: { kind: "retain" },
    terminalRetention: { kind: "retain" },
    entityDeletion: "dispose",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "ephemeral",
    flushOnShutdown: true,
    isTerminal: (state) => state.terminal === true,
    ...overrides,
  };
}

function machine(
  id: string,
  policy = lifecycle(),
): DistributedMachineDefinition<string, string, State, Event, Command, Reason> {
  return {
    id,
    host: "main",
    initialState: () => ({ value: 0 }),
    transition(state, event) {
      switch (event.type) {
        case "SET":
          return state.value === event.value
            ? stay(state, [])
            : change({ value: event.value });
        case "IGNORE":
          return ignore(state, "ignored");
        case "COMMAND":
          return stay(state, [{ type: "NOOP" }]);
        case "TERMINAL":
          return change({ value: state.value, terminal: true });
      }
    },
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: () => () => undefined,
    lifecycle: policy,
  };
}

function host(
  clock = createFakeClock(),
  reportError?: (error: ActorHostError) => void,
) {
  return new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError,
  });
}

describe("ActorHost", () => {
  it("passes the reusable local host conformance suite", async () => {
    await expect(runLocalActorHostConformanceSuite()).resolves.toBeUndefined();
  });

  it("tracks actor instance, reference revisions, and every transaction", async () => {
    const definition = machine("metadata");
    const actorHost = host();
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");
    const initial = actor.getSnapshot();

    expect(actor.getMetadata()).toEqual({
      actorInstanceId: "metadata-actor:1",
      snapshotRevision: 0,
      transactionSequence: 0,
    });

    actor.send({ type: "IGNORE" });
    expect(actor.getSnapshot()).toBe(initial);
    expect(actor.getMetadata()).toMatchObject({
      snapshotRevision: 0,
      transactionSequence: 1,
    });

    actor.send({ type: "COMMAND" });
    expect(actor.getSnapshot()).toBe(initial);
    expect(actor.getMetadata()).toMatchObject({
      snapshotRevision: 0,
      transactionSequence: 2,
    });

    actor.send({ type: "SET", value: 1 });
    expect(actor.getMetadata()).toMatchObject({
      snapshotRevision: 1,
      transactionSequence: 3,
    });

    await actorHost.dispose();
  });

  it("runs the ordered disposal policy and aggregates cleanup failures", async () => {
    const order: string[] = [];
    const definition = machine(
      "disposal-order",
      lifecycle({
        settleWaiters: async () => {
          order.push("settle");
        },
        projectTerminal: () => {
          order.push("project-terminal");
        },
        flush: async () => {
          order.push("flush");
        },
        onDisposed: () => {
          order.push("disposed");
        },
      }),
    );
    const actorHost = host();
    const runnable = {
      ...definition,
      createCommandRunner:
        (context: Parameters<typeof definition.createCommandRunner>[0]) =>
        () => {
          context.tasks.replace("task", () => order.push("cancel-task"));
          context.timers.replace(
            "timer",
            "token",
            100,
            () => ({ type: "IGNORE" }),
            context.send,
          );
        },
    };
    actorHost.register(runnable);
    const actor = actorHost.localRef(runnable, "entity");
    actor.send({ type: "COMMAND" });

    await actorHost.disposeKey(runnable.id, "entity");

    expect(order).toEqual([
      "settle",
      "project-terminal",
      "cancel-task",
      "flush",
      "disposed",
    ]);
  });

  it("honors creation, terminal, entity-deletion, and shutdown policies", async () => {
    const clock = createFakeClock();
    const flush = vi.fn();
    const noCreate = machine(
      "no-create",
      lifecycle({
        subscriptionCreates: false,
        dispatchCreates: false,
      }),
    );
    const terminal = machine(
      "terminal",
      lifecycle({
        terminalRetention: { kind: "dispose-after", delayMs: 5 },
      }),
    );
    const retainedOnDelete = machine(
      "retained-delete",
      lifecycle({ entityDeletion: "retain" }),
    );
    const noShutdownFlush = machine(
      "no-shutdown-flush",
      lifecycle({ flushOnShutdown: false, flush }),
    );
    const actorHost = host(clock);
    for (const definition of [
      noCreate,
      terminal,
      retainedOnDelete,
      noShutdownFlush,
    ]) {
      actorHost.register(definition);
    }

    expect(() => actorHost.localRef(noCreate, "entity")).toThrow(
      ActorAdmissionError,
    );
    await expect(
      actorHost.dispatch(noCreate, "entity", { type: "SET", value: 1 }).settled,
    ).resolves.toMatchObject({
      kind: "failed",
      stage: "before-admission",
    });

    actorHost.localRef(terminal, "entity").send({ type: "TERMINAL" });
    await Promise.resolve();
    clock.advanceBy(5);
    await Promise.resolve();
    expect(actorHost.peek(terminal.id, "entity")).toBeUndefined();

    actorHost.ensure(retainedOnDelete, "entity");
    await actorHost.entityDeleted(retainedOnDelete.id, "entity");
    expect(actorHost.peek(retainedOnDelete.id, "entity")).toBeDefined();

    actorHost.ensure(noShutdownFlush, "entity");
    await actorHost.dispose();
    expect(flush).not.toHaveBeenCalled();
  });

  it("rejects duplicate registration and wrong host placement", () => {
    const definition = machine("registered-once");
    const actorHost = host();
    actorHost.register(definition);
    expect(() => actorHost.register(definition)).toThrow("already registered");

    const rendererDefinition = {
      ...machine("renderer"),
      host: "renderer",
    } as const;
    expect(() => actorHost.register(rendererDefinition)).toThrow("not main");
  });

  it("disposes all machine keys without unregistering its definition", async () => {
    const definition = machine("machine-disposal");
    const actorHost = host();
    actorHost.register(definition);
    actorHost.ensure(definition, "a");
    actorHost.ensure(definition, "b");

    await actorHost.disposeMachine(definition.id);

    expect(actorHost.peek(definition.id, "a")).toBeUndefined();
    expect(actorHost.peek(definition.id, "b")).toBeUndefined();
    expect(actorHost.ensure(definition, "a").getSnapshot()).toEqual({
      value: 0,
    });
  });

  it("keeps same-key admission behind the final disposal barrier", async () => {
    let release!: () => void;
    const entered = vi.fn();
    const definition = machine(
      "keyed-barrier",
      lifecycle({
        settleWaiters: () =>
          new Promise<void>((resolve) => {
            entered();
            release = resolve;
          }),
      }),
    );
    const actorHost = host();
    actorHost.register(definition);
    const original = actorHost.ensure(definition, "entity");

    const firstDisposal = actorHost.disposeKey(definition.id, "entity");
    const secondDisposal = actorHost.disposeKey(definition.id, "entity");

    expect(entered).toHaveBeenCalledOnce();
    expect(() => actorHost.ensure(definition, "entity")).toThrow(
      ActorAdmissionError,
    );
    await expect(
      actorHost.dispatch(definition, "entity", { type: "SET", value: 1 })
        .settled,
    ).resolves.toMatchObject({
      kind: "failed",
      stage: "before-admission",
      error: expect.objectContaining({ code: "actor-disposing" }),
    });

    release();
    await Promise.all([firstDisposal, secondDisposal]);
    expect(actorHost.ensure(definition, "entity").actorInstanceId).not.toBe(
      original.actorInstanceId,
    );
  });

  it("returns one host shutdown barrier to concurrent callers", async () => {
    let release!: () => void;
    const definition = machine(
      "host-barrier",
      lifecycle({
        settleWaiters: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    );
    const actorHost = host();
    actorHost.register(definition);
    actorHost.ensure(definition, "entity");

    const first = actorHost.dispose();
    const second = actorHost.dispose();

    expect(second).toBe(first);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await Promise.all([first, second]);
    expect(settled).toBe(true);
  });

  it("cancels stale terminal retention when the actor becomes active", async () => {
    const clock = createFakeClock();
    const definition = machine(
      "terminal-reentry",
      lifecycle({
        terminalRetention: { kind: "dispose-after", delayMs: 5 },
      }),
    );
    const actorHost = host(clock);
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");

    actor.send({ type: "TERMINAL" });
    actor.send({ type: "SET", value: 2 });
    await Promise.resolve();
    await Promise.resolve();
    clock.advanceBy(5);
    await Promise.resolve();

    expect(actorHost.peek(definition.id, "entity")).toBe(actor);
    expect(actor.getSnapshot()).toEqual({ value: 2 });
  });

  it("does not postpone terminal disposal for traffic in the terminal state", async () => {
    const clock = createFakeClock();
    const onDisposed = vi.fn();
    const definition = machine(
      "terminal-deadline",
      lifecycle({
        terminalRetention: { kind: "dispose-after", delayMs: 5 },
        onDisposed,
      }),
    );
    const actorHost = host(clock);
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");

    actor.send({ type: "TERMINAL" });
    await Promise.resolve();
    clock.advanceBy(4);
    actor.send({ type: "IGNORE" });
    await Promise.resolve();
    clock.advanceBy(1);

    await vi.waitFor(() => expect(onDisposed).toHaveBeenCalledOnce());
    expect(actorHost.peek(definition.id, "entity")).toBeUndefined();
  });

  it("reconciles retention after asynchronous machine-context sends", async () => {
    const clock = createFakeClock();
    const onDisposed = vi.fn();
    const baseDefinition = machine(
      "internal-terminal",
      lifecycle({
        terminalRetention: { kind: "dispose-after", delayMs: 5 },
        onDisposed,
      }),
    );
    const definition = {
      ...baseDefinition,
      createCommandRunner:
        (context: Parameters<typeof baseDefinition.createCommandRunner>[0]) =>
        () => {
          context.timers.replace(
            "terminal",
            "token",
            1,
            () => ({ type: "TERMINAL" }),
            context.send,
          );
        },
    };
    const actorHost = host(clock);
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");

    actor.send({ type: "COMMAND" });
    clock.advanceBy(1);
    await Promise.resolve();
    clock.advanceBy(5);

    await vi.waitFor(() => expect(onDisposed).toHaveBeenCalledOnce());
    expect(actorHost.peek(definition.id, "entity")).toBeUndefined();
  });

  it("reconciles retention after asynchronous command emissions", async () => {
    const clock = createFakeClock();
    const onDisposed = vi.fn();
    const baseDefinition = machine(
      "command-terminal",
      lifecycle({
        terminalRetention: { kind: "dispose-after", delayMs: 5 },
        onDisposed,
      }),
    );
    const definition = {
      ...baseDefinition,
      createCommandRunner:
        (context: Parameters<typeof baseDefinition.createCommandRunner>[0]) =>
        (_command: Command, emit: (event: Event) => void) => {
          context.timers.replace(
            "terminal",
            "token",
            1,
            () => ({ type: "TERMINAL" }),
            emit,
          );
        },
    };
    const actorHost = host(clock);
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");

    actor.send({ type: "COMMAND" });
    clock.advanceBy(1);
    await Promise.resolve();
    clock.advanceBy(5);

    await vi.waitFor(() => expect(onDisposed).toHaveBeenCalledOnce());
    expect(actorHost.peek(definition.id, "entity")).toBeUndefined();
  });

  it("does not postpone idle eviction for idle-eligible traffic", async () => {
    const clock = createFakeClock();
    const onDisposed = vi.fn();
    const definition = machine(
      "idle-deadline",
      lifecycle({
        idleEviction: { kind: "dispose-after", delayMs: 5 },
        onDisposed,
      }),
    );
    const actorHost = host(clock);
    actorHost.register(definition);
    const actor = actorHost.localRef(definition, "entity");

    clock.advanceBy(4);
    actor.send({ type: "IGNORE" });
    await Promise.resolve();
    clock.advanceBy(1);

    await vi.waitFor(() => expect(onDisposed).toHaveBeenCalledOnce());
    expect(actorHost.peek(definition.id, "entity")).toBeUndefined();
  });

  it("runs definition lease cancellation before snapshot notification", () => {
    const order: string[] = [];
    const baseClock = createFakeClock();
    const clock = {
      ...baseClock,
      cancel(handle: Parameters<typeof baseClock.cancel>[0]) {
        order.push("cancel");
        baseClock.cancel(handle);
      },
    };
    const definition = machine("before-commit");
    const cancellable = {
      ...definition,
      createCommandRunner:
        (context: Parameters<typeof definition.createCommandRunner>[0]) =>
        () => {
          context.timers.replace(
            "watchdog",
            "token",
            100,
            () => ({ type: "IGNORE" }),
            context.send,
          );
        },
      createBeforeCommit:
        (context: Parameters<typeof definition.createCommandRunner>[0]) =>
        (previous: State, next: State) => {
          if (previous.value === 0 && next.value === 1) {
            context.timers.remove("watchdog");
          }
        },
    };
    const actorHost = host(clock);
    actorHost.register(cancellable);
    const actor = actorHost.localRef(cancellable, "entity");
    actor.send({ type: "COMMAND" });
    actor.subscribe(() => order.push("subscriber"));

    actor.send({ type: "SET", value: 1 });

    expect(order).toEqual(["cancel", "subscriber"]);
  });

  it("makes factory context safe and cleans scopes after construction failure", () => {
    const clock = createFakeClock();
    const eager = machine("eager-context");
    const eagerDefinition = {
      ...eager,
      createObserver(context: Parameters<typeof eager.createCommandRunner>[0]) {
        expect(context.getSnapshot()).toEqual({ value: 0 });
        context.send({ type: "SET", value: 4 });
        return {};
      },
    };
    const actorHost = host(clock);
    actorHost.register(eagerDefinition);
    expect(actorHost.ensure(eagerDefinition, "entity").getSnapshot()).toEqual({
      value: 4,
    });

    let cleanupCount = 0;
    const failing = machine("failing-context");
    const failingDefinition = {
      ...failing,
      createObserver(
        context: Parameters<typeof failing.createCommandRunner>[0],
      ) {
        context.tasks.replace("resource", () => {
          cleanupCount += 1;
        });
        context.timers.replace(
          "timer",
          "token",
          100,
          () => ({ type: "IGNORE" }),
          context.send,
        );
        throw new Error("factory failed");
      },
    };
    actorHost.register(failingDefinition);

    expect(() => actorHost.ensure(failingDefinition, "entity")).toThrow(
      "factory failed",
    );
    expect(cleanupCount).toBe(1);
    expect(clock.pendingTimerCount()).toBe(0);
    expect(actorHost.peek(failingDefinition.id, "entity")).toBeUndefined();
  });

  it("reports terminal-policy failures without rejecting dispatch", async () => {
    const failures: ActorHostError[] = [];
    const policyFailure = new Error("terminal policy failed");
    const definition = machine(
      "terminal-policy-failure",
      lifecycle({
        isTerminal: () => {
          throw policyFailure;
        },
      }),
    );
    const actorHost = host(createFakeClock(), (failure) =>
      failures.push(failure),
    );
    actorHost.register(definition);
    const actor = actorHost.ensure(definition, "entity");
    failures.length = 0;

    const ticket = actor.enqueue({ type: "SET", value: 1 });

    await expect(ticket.settled).resolves.toMatchObject({ kind: "applied" });
    await Promise.resolve();
    expect(failures).toEqual([
      expect.objectContaining({ failure: policyFailure }),
    ]);
  });

  it("evicts untouched actors under a bounded idle policy", async () => {
    const clock = createFakeClock();
    const definition = machine(
      "initial-idle",
      lifecycle({
        idleEviction: { kind: "dispose-after", delayMs: 5 },
      }),
    );
    const actorHost = host(clock);
    actorHost.register(definition);
    actorHost.ensure(definition, "entity");

    clock.advanceBy(5);
    await actorHost.disposeKey(definition.id, "entity");

    expect(actorHost.peek(definition.id, "entity")).toBeUndefined();
  });
});
