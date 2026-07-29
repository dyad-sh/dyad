import { describe, expect, it } from "vitest";
import type {
  CommandExecutor,
  ReservedCommandBatch,
} from "@/state_machines/dispatcher";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { change } from "@/state_machines/types";
import {
  ActorAdmissionError,
  ActorHost,
  type ActorDisposedEvent,
  type ActorHostError,
} from "./actor_host";
import type {
  ActorEventSink,
  DistributedMachineDefinition,
  MachineHostContext,
} from "./definition";

type Event =
  | { readonly type: "WORK" }
  | { readonly type: "CLEANUP" }
  | { readonly type: "COMMAND" }
  | { readonly type: "COMMAND_DONE" }
  | { readonly type: "TIMER" }
  | { readonly type: "PRODUCER" };
type Command = { readonly type: "WAIT" };
type State = { readonly events: readonly Event["type"][] };
type Reason = "ignored";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

function machine(options: {
  readonly id: string;
  readonly runCommand?: (
    context: MachineHostContext<string, State, Event>,
    emit: (event: Event) => void,
  ) => void | Promise<void>;
  readonly createObserver?: DistributedMachineDefinition<
    string,
    string,
    State,
    Event,
    Command,
    Reason
  >["createObserver"];
  readonly onTransition?: (event: Event) => void;
  readonly onDisposed?: () => void | Promise<void>;
}): DistributedMachineDefinition<
  string,
  string,
  State,
  Event,
  Command,
  Reason
> {
  return {
    id: options.id,
    host: "main",
    initialState: () => ({ events: [] }),
    transition(state, event) {
      options.onTransition?.(event);
      const next = { events: [...state.events, event.type] };
      return event.type === "COMMAND"
        ? change(next, [{ type: "WAIT" }])
        : change(next);
    },
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: (context) => (_command, emit) =>
      options.runCommand?.(context, emit),
    createObserver: options.createObserver,
    lifecycle: {
      subscriptionCreates: true,
      dispatchCreates: true,
      idleEviction: { kind: "retain" },
      terminalRetention: { kind: "retain" },
      entityDeletion: "dispose",
      rendererOwnership: "host",
      survivesRendererReload: true,
      restartPersistence: "ephemeral",
      flushOnShutdown: true,
      onDisposed: options.onDisposed,
    },
  };
}

function harness(
  definition: ReturnType<typeof machine>,
  errors: ActorHostError[] = [],
) {
  const clock = createFakeClock();
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError: (error) => errors.push(error),
  });
  host.register(definition);
  return { clock, host };
}

describe("ActorHost keyed admission integration", () => {
  it("admits correlated output after an unrelated revision of the same actor", async () => {
    let context!: MachineHostContext<string, State, Event>;
    const definition = machine({
      id: "revision-bound-sink",
      runCommand(commandContext) {
        context = commandContext;
      },
    });
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");
    actor.send({ type: "COMMAND" });
    const sink = context.captureSink();
    actor.send({ type: "WORK" });
    sink.send({ type: "PRODUCER" });

    expect(actor.getSnapshot().events).toEqual(["COMMAND", "WORK", "PRODUCER"]);
    await host.dispose();
  });

  it("advances a command sink across its own sequential emissions", async () => {
    const finished = deferred();
    const definition = machine({
      id: "sequential-command-output",
      async runCommand(_context, emit) {
        emit({ type: "PRODUCER" });
        await Promise.resolve();
        emit({ type: "COMMAND_DONE" });
        finished.resolve();
      },
    });
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");
    actor.send({ type: "COMMAND" });
    await finished.promise;

    expect(actor.getSnapshot().events).toEqual([
      "COMMAND",
      "PRODUCER",
      "COMMAND_DONE",
    ]);
    await host.dispose();
  });

  it("advances a captured sink across sequential construction-time emissions", async () => {
    const definition = machine({
      id: "sequential-construction-output",
      createObserver(context) {
        const sink = context.captureSink();
        sink.send({ type: "WORK" });
        sink.send({ type: "PRODUCER" });
        return {};
      },
    });
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");

    expect(actor.getSnapshot().events).toEqual(["WORK", "PRODUCER"]);
    await host.dispose();
  });

  it("fails closed when a legacy command runner hands off detached work", async () => {
    const detached = deferred();
    const definition = machine({
      id: "detached-command-compatibility",
      runCommand(_context, emit) {
        void detached.promise.then(() => {
          emit({ type: "COMMAND_DONE" });
        });
      },
    });
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");
    actor.send({ type: "COMMAND" });

    expect(() =>
      host.beginFence(definition, {
        key: "one",
        allowDuringDrain: (event) => event.type === "COMMAND_DONE",
      }),
    ).toThrow(
      expect.objectContaining({ code: "untracked-command-completion" }),
    );

    detached.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(actor.getSnapshot().events).toEqual(["COMMAND", "COMMAND_DONE"]);
    await host.dispose();
  });

  it("does not seal over a detached command admitted during draining", async () => {
    const detached = deferred();
    const definition = machine({
      id: "detached-command-during-drain",
      runCommand(_context, emit) {
        void detached.promise.then(() => {
          emit({ type: "COMMAND_DONE" });
        });
      },
    });
    const { host } = harness(definition);
    host.localRef(definition, "one");
    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: (event) => event.type === "COMMAND",
    });

    await expect(
      host.dispatch(definition, "one", { type: "COMMAND" } as Event).settled,
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(fence.seal()).rejects.toMatchObject({
      code: "untracked-command-completion",
    });
    expect(fence.abort()).toBe(true);

    detached.resolve();
    await host.dispose();
  });

  it("gates local, command, timer, producer, and creation ingress through one fence", async () => {
    const command = deferred();
    let context!: MachineHostContext<string, State, Event>;
    let producer!: ActorEventSink<Event>;
    const definition = machine({
      id: "all-ingress",
      async runCommand(commandContext, emit) {
        context = commandContext;
        await command.promise;
        emit({ type: "COMMAND_DONE" });
      },
    });
    const { clock, host } = harness(definition);
    const actor = host.localRef(definition, "one");
    context = undefined as unknown as typeof context;
    actor.send({ type: "COMMAND" });
    producer = context.captureSink();
    context.timers.replace(
      "watchdog",
      "token",
      10,
      () => ({ type: "TIMER" }),
      context.captureSink().send,
    );

    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: (event) =>
        event.type === "CLEANUP" || event.type === "COMMAND_DONE",
    });
    expect(host.inspectAdmission(definition.id, "one").phase).toBe("draining");
    const other = host.localRef(definition, "two");
    other.send({ type: "WORK" });
    expect(other.getSnapshot().events).toEqual(["WORK"]);

    const ordinary = host.dispatch(definition, "one", {
      type: "WORK",
    } as Event);
    await expect(ordinary.settled).resolves.toMatchObject({
      kind: "failed",
      stage: "before-admission",
      error: expect.objectContaining({ code: "key-fenced" }),
    });
    await expect(
      host.dispatch(definition, "one", { type: "CLEANUP" } as Event).settled,
    ).resolves.toMatchObject({ kind: "applied" });

    const sealing = fence.seal();
    expect(await isSettled(sealing)).toBe(false);
    command.resolve();
    await sealing;
    expect(actor.getSnapshot().events).toEqual([
      "COMMAND",
      "CLEANUP",
      "COMMAND_DONE",
    ]);

    actor.send({ type: "WORK" });
    producer.send({ type: "PRODUCER" });
    clock.advanceBy(10);
    await expect(
      host.dispatch(definition, "one", { type: "CLEANUP" } as Event).settled,
    ).resolves.toMatchObject({ kind: "failed" });
    expect(actor.getSnapshot().events).toEqual([
      "COMMAND",
      "CLEANUP",
      "COMMAND_DONE",
    ]);

    fence.commit();
    expect(host.inspectAdmission(definition.id, "one").phase).toBe("committed");
    await host.disposeKey(definition.id, "one");
    expect(() => host.localRef(definition, "one")).toThrow(ActorAdmissionError);

    fence.release();
    const replacement = host.localRef(definition, "one");
    producer.send({ type: "PRODUCER" });
    expect(replacement.getSnapshot().events).toEqual([]);
    await host.dispose();
  });

  it("invalidates scheduler callbacks that have not started when scheduling fails", async () => {
    let delayedExecute!: CommandExecutor<Command>;
    let delayedBatch!: ReservedCommandBatch<Command>;
    let commandRuns = 0;
    const base = machine({
      id: "failed-scheduler",
      runCommand() {
        commandRuns += 1;
      },
    });
    const definition: typeof base = {
      ...base,
      createScheduler: () => ({
        schedule(batch, execute) {
          delayedBatch = batch;
          delayedExecute = execute;
          throw new Error("scheduler retained callback before failing");
        },
      }),
    };
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");
    actor.send({ type: "COMMAND" });

    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: () => false,
    });
    await fence.seal();
    await delayedExecute(delayedBatch.commands[0]!);

    expect(commandRuns).toBe(0);
    expect(actor.getSnapshot().events).toEqual(["COMMAND"]);
    await host.dispose();
  });

  it("does not retain an orphan continuation for output sent after disposal", async () => {
    let sink!: ActorEventSink<Event>;
    const definition = machine({
      id: "disposed-output",
      runCommand(context) {
        sink = context.captureSink();
      },
    });
    const { host } = harness(definition);
    const actor = host.localRef(definition, "one");
    actor.send({ type: "COMMAND" });
    await host.disposeKey(definition.id, "one");

    sink.send({ type: "PRODUCER" });

    expect(
      (
        actor as unknown as {
          readonly pendingContinuations: readonly unknown[];
        }
      ).pendingContinuations,
    ).toHaveLength(0);
    await host.dispose();
  });

  it("does not admit an actor whose construction crosses fence publication", async () => {
    const cleanup = deferred();
    const disposed: ActorDisposedEvent[] = [];
    const errors: ActorHostError[] = [];
    let host!: ActorHost;
    let fence!: ReturnType<ActorHost["beginFence"]>;
    let definition!: ReturnType<typeof machine>;
    definition = machine({
      id: "construction-race",
      createObserver(context) {
        context.send({ type: "WORK" });
        fence = host.beginFence(definition, {
          key: context.key,
          allowDuringDrain: (event) => event.type === "WORK",
        });
        return {};
      },
      onDisposed: () => cleanup.promise,
    });
    ({ host } = harness(definition, errors));
    host.onActorDisposed((event) => disposed.push(event));

    expect(() => host.localRef(definition, "one")).toThrow(
      expect.objectContaining({ code: "stale-admission-generation" }),
    );
    expect(host.peek(definition.id, "one")).toBeUndefined();
    const sealing = fence.seal();
    expect(await isSettled(sealing)).toBe(false);

    cleanup.resolve();
    await sealing;
    expect(disposed).toHaveLength(1);
    expect(disposed[0]?.snapshot).toEqual({ events: [] });
    expect(errors).toEqual([]);
    expect(fence.abort()).toBe(true);
    expect(host.inspectAdmission(definition.id, "one").phase).toBe("open");
    await host.dispose();
  });

  it("settles construction tracking after machine-disposal reentry", async () => {
    let host!: ActorHost;
    let machineDisposal!: Promise<void>;
    let definition!: ReturnType<typeof machine>;
    definition = machine({
      id: "construction-machine-disposal",
      createObserver(context) {
        context.send({ type: "WORK" });
        return {};
      },
      onTransition(event) {
        if (event.type === "WORK") {
          machineDisposal = host.disposeMachine(definition.id);
        }
      },
    });
    ({ host } = harness(definition));

    expect(() => host.localRef(definition, "one")).toThrow(
      expect.objectContaining({ code: "machine-disposing" }),
    );
    await machineDisposal;

    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: () => false,
    });
    const sealing = fence.seal();
    expect(await isSettled(sealing)).toBe(true);
    await sealing;
    expect(fence.abort()).toBe(true);
    await host.dispose();
  });

  it("composes host disposal and cleanup failure without leaking a live fence", async () => {
    const errors: ActorHostError[] = [];
    const definition = machine({
      id: "fenced-host-disposal",
      onDisposed() {
        throw new Error("synthetic cleanup failure");
      },
    });
    const { host } = harness(definition, errors);
    host.localRef(definition, "one");
    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: () => false,
    });
    await fence.seal();

    await expect(host.dispose()).rejects.toThrow("ActorHost disposal failed");
    expect(fence.abort()).toBe(false);
    expect(fence.commit()).toBe(false);
    expect(fence.release()).toBe(false);
  });

  it("keeps a keyed fence authoritative across machine disposal", async () => {
    const definition = machine({ id: "fenced-machine-disposal" });
    const { host } = harness(definition);
    host.localRef(definition, "one");
    const fence = host.beginFence(definition, {
      key: "one",
      allowDuringDrain: () => false,
    });

    await host.disposeMachine(definition.id);
    expect(() => host.localRef(definition, "one")).toThrow(
      expect.objectContaining({ code: "key-fenced" }),
    );
    expect(fence.abort()).toBe(true);
    expect(host.localRef(definition, "one").getSnapshot()).toEqual({
      events: [],
    });
    await host.dispose();
  });
});
