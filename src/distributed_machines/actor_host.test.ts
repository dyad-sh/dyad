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
});
