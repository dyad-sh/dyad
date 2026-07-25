import { change, ignore, stay } from "@/state_machines/types";
import {
  createFakeClock,
  createSequentialIdSource,
  type FakeClock,
} from "@/state_machines/testing";
import {
  ActorHost,
  type ActorHostError,
  type ActorHostOptions,
} from "../actor_host";
import type {
  ActorLifecyclePolicy,
  DistributedMachineDefinition,
  HostedActorRef,
  MachineHostContext,
} from "../definition";

type State = { readonly value: number };
type Event =
  | { readonly type: "SET"; readonly value: number }
  | { readonly type: "IGNORE" }
  | { readonly type: "COMMAND"; readonly command: Command };
type Command =
  | { readonly type: "EMIT"; readonly event: Event }
  | { readonly type: "DEFER" }
  | { readonly type: "THROW" }
  | { readonly type: "RESOURCE" };
type Reason = "ignored";

export interface ActorHostConformanceFactory {
  create(options: ActorHostOptions): ConformantActorHost;
}

export type ConformantActorHost = Pick<
  ActorHost,
  "register" | "localRef" | "dispatch" | "peek" | "disposeKey" | "dispose"
>;

const productionFactory: ActorHostConformanceFactory = {
  create: (options) => new ActorHost(options),
};

function assert(
  condition: unknown,
  scenario: string,
  detail: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Actor host conformance failed: ${scenario}: ${detail}`);
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
    ...overrides,
  };
}

function definition(options: {
  readonly id: string;
  readonly scheduler?: DistributedMachineDefinition<
    string,
    string,
    State,
    Event,
    Command,
    Reason
  >["createScheduler"];
  readonly observer?: DistributedMachineDefinition<
    string,
    string,
    State,
    Event,
    Command,
    Reason
  >["createObserver"];
  readonly run?: (
    context: MachineHostContext<string, State, Event>,
    command: Command,
    emit: (event: Event) => void,
  ) => void | Promise<void>;
  readonly lifecycle?: ActorLifecyclePolicy<string, State>;
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
          return stay(state, [event.command]);
      }
    },
    createScheduler:
      options.scheduler ??
      (() => ({
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      })),
    createCommandRunner: (context) => (command, emit) => {
      if (command.type === "EMIT") emit(command.event);
      return options.run?.(context, command, emit);
    },
    createObserver: options.observer,
    lifecycle: options.lifecycle ?? lifecycle(),
  };
}

function createHarness(
  factory: ActorHostConformanceFactory,
  machine: ReturnType<typeof definition>,
  clock: FakeClock = createFakeClock(),
  errors: ActorHostError[] = [],
) {
  const host = factory.create({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError: (error) => errors.push(error),
  });
  host.register(machine);
  return { host, clock, errors };
}

/**
 * Runs the B2 local-host contract against an ActorHost implementation.
 *
 * The fixture is synthetic and policy-free, so alternate hosted-actor
 * implementations can run the same adversarial scenarios.
 */
export async function runLocalActorHostConformanceSuite(
  factory: ActorHostConformanceFactory = productionFactory,
): Promise<void> {
  {
    let actor: HostedActorRef<State, Event, Reason> | undefined;
    const machine = definition({
      id: "reentrant-observer",
      observer: () => ({
        onTransitionApplied({ state }) {
          if (state.value === 1) actor?.send({ type: "SET", value: 2 });
        },
      }),
    });
    const { host } = createHarness(factory, machine);
    actor = host.localRef(machine, "key");
    actor.send({ type: "SET", value: 1 });
    assert(
      actor.getSnapshot().value === 2,
      "re-entrant observer",
      "the observer event did not run after the outer commit",
    );
    await host.dispose();
  }

  {
    const machine = definition({ id: "reentrant-subscriber" });
    const { host } = createHarness(factory, machine);
    const actor = host.localRef(machine, "key");
    let calls = 0;
    actor.subscribe(() => {
      calls += 1;
      if (calls === 1) actor.send({ type: "SET", value: 2 });
    });
    actor.send({ type: "SET", value: 1 });
    assert(
      calls === 2 && actor.getSnapshot().value === 2,
      "re-entrant subscriber",
      "the subscriber event was lost or ran against the old snapshot",
    );
    await host.dispose();
  }

  {
    const machine = definition({ id: "command-emission" });
    const { host } = createHarness(factory, machine);
    const actor = host.localRef(machine, "key");
    actor.send({
      type: "COMMAND",
      command: { type: "EMIT", event: { type: "SET", value: 3 } },
    });
    assert(
      actor.getSnapshot().value === 3,
      "re-entrant command",
      "the command event did not receive its own FIFO turn",
    );
    await host.dispose();
  }

  for (const asynchronous of [false, true]) {
    const errors: ActorHostError[] = [];
    const machine = definition({
      id: asynchronous ? "scheduler-reject" : "scheduler-throw",
      scheduler: () => ({
        schedule() {
          const error = new Error("scheduler failure");
          if (asynchronous) return Promise.reject(error);
          throw error;
        },
      }),
    });
    const { host } = createHarness(factory, machine, createFakeClock(), errors);
    const actor = host.localRef(machine, "key");
    const ticket = actor.enqueue({
      type: "COMMAND",
      command: { type: "RESOURCE" },
    });
    await ticket.settled;
    await flush();
    assert(
      errors.some(
        ({ failure }) =>
          typeof failure === "object" &&
          failure !== null &&
          "stage" in failure &&
          failure.stage === "scheduler",
      ),
      asynchronous ? "scheduler rejection" : "scheduler throw",
      "the scheduler failure was not isolated and reported",
    );
    await host.dispose();
  }

  {
    let finish: (() => void) | undefined;
    const machine = definition({
      id: "dispose-during-command",
      run(_context, command, emit) {
        if (command.type !== "DEFER") return;
        return new Promise<void>((resolve) => {
          finish = () => {
            emit({ type: "SET", value: 9 });
            resolve();
          };
        });
      },
    });
    const { host } = createHarness(factory, machine);
    const actor = host.localRef(machine, "key");
    actor.send({ type: "COMMAND", command: { type: "DEFER" } });
    const snapshot = actor.getSnapshot();
    await host.disposeKey(machine.id, "key");
    finish?.();
    await flush();
    actor.send({ type: "SET", value: 7 });
    assert(
      actor.getSnapshot() === snapshot,
      "dispose during command and late event",
      "a late command or local send changed a disposed actor",
    );
    await host.dispose();
  }

  {
    const machine = definition({ id: "recreation" });
    const { host } = createHarness(factory, machine);
    const oldActor = host.localRef(machine, "key");
    const oldId = oldActor.actorInstanceId;
    await host.disposeKey(machine.id, "key");
    const replacement = host.localRef(machine, "key");
    const stale = host.dispatch(
      machine,
      "key",
      { type: "SET", value: 5 },
      oldId,
    );
    assert(
      replacement.actorInstanceId !== oldId,
      "key recreation",
      "the actor instance identity was reused",
    );
    assert(
      (await stale.settled).kind === "failed" &&
        replacement.getSnapshot().value === 0,
      "stale actor rejection",
      "a stale instance dispatch reached the replacement",
    );
    await host.dispose();
  }

  {
    const clock = createFakeClock();
    let resourceCleanups = 0;
    const machine = definition({
      id: "idle-cleanup",
      lifecycle: lifecycle({
        idleEviction: { kind: "dispose-after", delayMs: 10 },
      }),
      run(context, command) {
        if (command.type !== "RESOURCE") return;
        context.tasks.replace("resource", () => {
          resourceCleanups += 1;
        });
        context.timers.replace(
          "timer",
          "token",
          100,
          () => ({ type: "SET", value: 99 }),
          context.send,
        );
      },
    });
    const { host } = createHarness(factory, machine, clock);
    const actor = host.localRef(machine, "key");
    const unsubscribe = actor.subscribe(() => undefined);
    actor.send({ type: "COMMAND", command: { type: "RESOURCE" } });
    unsubscribe();
    clock.advanceBy(10);
    assert(
      host.peek(machine.id, "key") === undefined,
      "bounded idle eviction admission",
      "the actor still admitted work after its idle bound",
    );
    await host.disposeKey(machine.id, "key");
    assert(
      resourceCleanups === 1 && clock.pendingTimerCount() === 0,
      "bounded idle eviction and cleanup",
      "the actor, task, or timer survived its idle bound",
    );
    await host.dispose();
  }

  {
    const clock = createFakeClock();
    const machine = definition({
      id: "initial-idle",
      lifecycle: lifecycle({
        idleEviction: { kind: "dispose-after", delayMs: 10 },
      }),
    });
    const { host } = createHarness(factory, machine, clock);
    host.localRef(machine, "untouched");
    clock.advanceBy(10);
    await host.disposeKey(machine.id, "untouched");
    assert(
      host.peek(machine.id, "untouched") === undefined,
      "initial bounded idle eviction",
      "an untouched zero-subscriber actor survived its idle bound",
    );
    await host.dispose();
  }
}
