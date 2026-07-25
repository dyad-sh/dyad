import {
  TransactionalDispatcher,
  type DispatchTicket,
  type DispatchTicketOutcome,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import { TaskScope, collectDisposalError } from "@/state_machines/task_scope";
import { TimerLeaseScope } from "@/state_machines/timer_lease";
import { createTraceObserver } from "@/state_machines/trace";
import type { Clock, ClockHandle, IdSource } from "@/state_machines/clock";
import type { IgnoreReason, TransitionObserver } from "@/state_machines/types";
import type {
  ActorDisposalCause,
  ActorDisposalContext,
  ActorInstanceId,
  ActorRuntimeMetadata,
  DistributedMachineDefinition,
  HostedActorRef,
  MachineHostContext,
} from "./definition";

type AnyDefinition = DistributedMachineDefinition<
  string,
  unknown,
  unknown,
  unknown,
  unknown,
  IgnoreReason
>;

export interface ActorHostError {
  readonly machineId: string;
  readonly key: unknown;
  readonly failure: DispatcherError | unknown;
}

export interface ActorHostOptions {
  readonly placement: "main" | "renderer";
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly reportError?: (error: ActorHostError) => void;
}

export class ActorAdmissionError extends Error {
  constructor(
    readonly code:
      | "dispatch-does-not-create"
      | "subscription-does-not-create"
      | "stale-actor-instance"
      | "host-disposed"
      | "actor-disposing",
    message: string,
  ) {
    super(message);
    this.name = "ActorAdmissionError";
  }
}

function settledTicket<State, Reason extends IgnoreReason>(
  outcome: DispatchTicketOutcome<State, Reason>,
): DispatchTicket<State, Reason> {
  return { settled: Promise.resolve(outcome) };
}

function composeObservers<State, Event, Command, Reason extends IgnoreReason>(
  observers: readonly (
    | TransitionObserver<State, Event, Command, Reason>
    | undefined
  )[],
): TransitionObserver<State, Event, Command, Reason> {
  return {
    onTransitionApplied(args) {
      for (const observer of observers) observer?.onTransitionApplied?.(args);
    },
    onEventIgnored(args) {
      for (const observer of observers) observer?.onEventIgnored?.(args);
    },
  };
}

class HostedActor<
  Key,
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
> implements HostedActorRef<State, Event, Reason> {
  readonly kind = "local" as const;
  readonly actorInstanceId: ActorInstanceId;
  private readonly tasks = new TaskScope<PropertyKey>();
  private readonly timers: TimerLeaseScope<PropertyKey, unknown, Event>;
  private readonly dispatcher: TransactionalDispatcher<
    State,
    Event,
    Command,
    Reason
  >;
  private revision = 0;
  private transactionSequence = 0;
  private subscriberCount = 0;
  private idleTimer: ClockHandle | undefined;
  private terminalTimer: ClockHandle | undefined;
  private disposing = false;
  private disposal: Promise<void> | undefined;
  private lastProjectedSnapshot: State;

  constructor(
    readonly definition: DistributedMachineDefinition<
      string,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
    readonly key: Key,
    private readonly options: ActorHostOptions,
    private readonly removeFromHost: (
      actor: HostedActor<Key, State, Event, Command, Reason>,
    ) => void,
  ) {
    this.actorInstanceId = options.ids.next(`${definition.id}-actor`);
    const initialState = definition.initialState(key);
    this.lastProjectedSnapshot = initialState;
    this.timers = new TimerLeaseScope(options.clock);

    let dispatcher!: TransactionalDispatcher<State, Event, Command, Reason>;
    const context: MachineHostContext<Key, State, Event> = {
      key,
      actorInstanceId: this.actorInstanceId,
      ids: options.ids,
      tasks: this.tasks,
      timers: this.timers,
      getMetadata: () => this.getMetadata(),
      getSnapshot: () => dispatcher.getSnapshot(),
      send: (event) => dispatcher.send(event),
    };
    const domainObserver = definition.createObserver?.(context);
    const traceObserver = createTraceObserver<State, Event, Command, Reason>(
      definition.id,
      typeof key === "string" || typeof key === "number" ? key : String(key),
    );

    dispatcher = new TransactionalDispatcher({
      initialState,
      transition: (state, event) => {
        this.transactionSequence += 1;
        return definition.transition(state, event);
      },
      scheduler: definition.createScheduler(key),
      runCommand: definition.createCommandRunner(context),
      project: (snapshot) => {
        if (snapshot !== this.lastProjectedSnapshot) {
          this.lastProjectedSnapshot = snapshot;
          this.revision += 1;
        }
      },
      observer: composeObservers([traceObserver, domainObserver]),
      reportError: (failure) =>
        options.reportError?.({
          machineId: definition.id,
          key,
          failure,
        }),
    });
    this.dispatcher = dispatcher;
  }

  getSnapshot = (): State => this.dispatcher.getSnapshot();

  getMetadata = (): ActorRuntimeMetadata => ({
    actorInstanceId: this.actorInstanceId,
    snapshotRevision: this.revision,
    transactionSequence: this.transactionSequence,
  });

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposing || !this.dispatcher.isAccepting()) {
      return () => undefined;
    }
    this.cancelIdleEviction();
    this.subscriberCount += 1;
    let subscribed = true;
    const unsubscribe = this.dispatcher.subscribe(listener);
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribe();
      this.subscriberCount -= 1;
      if (this.subscriberCount === 0) this.scheduleIdleEviction();
    };
  };

  send = (event: Event): void => {
    void this.enqueue(event);
  };

  enqueue = (event: Event): DispatchTicket<State, Reason> => {
    this.cancelIdleEviction();
    const ticket = this.dispatcher.enqueue(event);
    void ticket.settled.then((outcome) => {
      if (
        outcome.kind === "applied" &&
        this.definition.lifecycle.isTerminal?.(outcome.state)
      ) {
        this.scheduleTerminalDisposal();
      } else if (outcome.kind !== "disposed" && this.subscriberCount === 0) {
        this.scheduleIdleEviction();
      }
    });
    return ticket;
  };

  enqueueExpected(
    event: Event,
    expectedActorInstanceId?: ActorInstanceId,
  ): DispatchTicket<State, Reason> {
    if (
      expectedActorInstanceId !== undefined &&
      expectedActorInstanceId !== this.actorInstanceId
    ) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "stale-actor-instance",
          `Actor ${this.definition.id} was recreated`,
        ),
      });
    }
    return this.enqueue(event);
  }

  stopAdmission(): void {
    this.dispatcher.stopAdmission();
    this.cancelRetentionTimers();
  }

  dispose(cause: ActorDisposalCause): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposing = true;
    this.stopAdmission();
    this.removeFromHost(this);
    const context: ActorDisposalContext<Key, State> = {
      key: this.key,
      cause,
      metadata: this.getMetadata(),
      snapshot: this.getSnapshot(),
    };
    this.disposal = this.finishDisposal(context);
    return this.disposal;
  }

  private async finishDisposal(
    context: ActorDisposalContext<Key, State>,
  ): Promise<void> {
    const errors: unknown[] = [];
    await this.runDisposalStep(errors, () =>
      this.definition.lifecycle.settleWaiters?.(context),
    );
    await this.runDisposalStep(errors, () =>
      this.definition.lifecycle.projectTerminal?.(context),
    );
    collectDisposalError(errors, () => this.timers.dispose());
    collectDisposalError(errors, () => this.tasks.dispose());
    if (
      context.cause !== "shutdown" ||
      this.definition.lifecycle.flushOnShutdown
    ) {
      await this.runDisposalStep(errors, () =>
        this.definition.lifecycle.flush?.(context),
      );
    }
    this.dispatcher.dispose();
    await this.runDisposalStep(errors, () =>
      this.definition.lifecycle.onDisposed?.(context),
    );
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Actor ${this.definition.id} disposal failed`,
      );
    }
  }

  private async runDisposalStep(
    errors: unknown[],
    step: () => void | Promise<void> | undefined,
  ): Promise<void> {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }

  private scheduleIdleEviction(): void {
    const policy = this.definition.lifecycle.idleEviction;
    if (policy.kind === "retain" || this.disposing) return;
    this.cancelIdleEviction();
    this.idleTimer = this.options.clock.schedule(() => {
      this.idleTimer = undefined;
      if (this.subscriberCount === 0) {
        void this.dispose("idle").catch((failure) =>
          this.options.reportError?.({
            machineId: this.definition.id,
            key: this.key,
            failure,
          }),
        );
      }
    }, policy.delayMs);
  }

  private scheduleTerminalDisposal(): void {
    const policy = this.definition.lifecycle.terminalRetention;
    if (policy.kind === "retain" || this.disposing) return;
    if (this.terminalTimer !== undefined) {
      this.options.clock.cancel(this.terminalTimer);
    }
    this.terminalTimer = this.options.clock.schedule(() => {
      this.terminalTimer = undefined;
      void this.dispose("terminal").catch((failure) =>
        this.options.reportError?.({
          machineId: this.definition.id,
          key: this.key,
          failure,
        }),
      );
    }, policy.delayMs);
  }

  private cancelIdleEviction(): void {
    if (this.idleTimer === undefined) return;
    this.options.clock.cancel(this.idleTimer);
    this.idleTimer = undefined;
  }

  private cancelRetentionTimers(): void {
    this.cancelIdleEviction();
    if (this.terminalTimer === undefined) return;
    this.options.clock.cancel(this.terminalTimer);
    this.terminalTimer = undefined;
  }
}

export class ActorHost {
  private readonly definitions = new Map<string, AnyDefinition>();
  private readonly actors = new Map<
    string,
    Map<unknown, HostedActor<any, any, any, any, any>>
  >();
  private disposed = false;

  constructor(private readonly options: ActorHostOptions) {}

  register<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
  ): void {
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (definition.host !== this.options.placement) {
      throw new Error(
        `Machine ${definition.id} is placed in ${definition.host}, not ${this.options.placement}`,
      );
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Machine ${definition.id} is already registered`);
    }
    this.definitions.set(definition.id, definition as AnyDefinition);
  }

  ensure<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
    key: Key,
  ): HostedActorRef<State, Event, Reason> {
    this.assertRegistered(definition);
    return this.ensureRegistered(definition, key);
  }

  peek<State, Event, Reason extends IgnoreReason>(
    machineId: string,
    key: unknown,
  ): HostedActorRef<State, Event, Reason> | undefined {
    return this.actors.get(machineId)?.get(key);
  }

  localRef<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
    key: Key,
  ): HostedActorRef<State, Event, Reason> {
    this.assertRegistered(definition);
    const existing = this.peek<State, Event, Reason>(definition.id, key);
    if (existing) return existing;
    if (!definition.lifecycle.subscriptionCreates) {
      throw new ActorAdmissionError(
        "subscription-does-not-create",
        `Subscription does not create ${definition.id}`,
      );
    }
    return this.ensureRegistered(definition, key);
  }

  dispatch<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
    key: Key,
    event: Event,
    expectedActorInstanceId?: ActorInstanceId,
  ): DispatchTicket<State, Reason> {
    this.assertRegistered(definition);
    let actor = this.actors.get(definition.id)?.get(key) as
      | HostedActor<Key, State, Event, Command, Reason>
      | undefined;
    if (!actor) {
      if (expectedActorInstanceId !== undefined) {
        return settledTicket({
          kind: "failed",
          stage: "before-admission",
          error: new ActorAdmissionError(
            "stale-actor-instance",
            `Actor ${definition.id} no longer exists`,
          ),
        });
      }
      if (!definition.lifecycle.dispatchCreates) {
        return settledTicket({
          kind: "failed",
          stage: "before-admission",
          error: new ActorAdmissionError(
            "dispatch-does-not-create",
            `Dispatch does not create ${definition.id}`,
          ),
        });
      }
      actor = this.ensureRegistered(definition, key);
    }
    return actor.enqueueExpected(event, expectedActorInstanceId);
  }

  async disposeKey(
    machineId: string,
    key: unknown,
    cause: ActorDisposalCause = "explicit",
  ): Promise<void> {
    await this.actors.get(machineId)?.get(key)?.dispose(cause);
  }

  async entityDeleted(machineId: string, key: unknown): Promise<void> {
    const definition = this.definition(machineId);
    if (definition.lifecycle.entityDeletion === "dispose") {
      await this.disposeKey(machineId, key, "entity-deletion");
    }
  }

  async disposeMachine(machineId: string): Promise<void> {
    const actors = [...(this.actors.get(machineId)?.values() ?? [])];
    await this.disposeActors(actors, "machine-disposal");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const actors = [...this.actors.values()].flatMap((keyed) => [
      ...keyed.values(),
    ]);
    for (const actor of actors) actor.stopAdmission();
    try {
      await this.disposeActors(actors, "shutdown");
    } finally {
      this.definitions.clear();
    }
  }

  private ensureRegistered<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason
    >,
    key: Key,
  ): HostedActor<Key, State, Event, Command, Reason> {
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    let keyed = this.actors.get(definition.id);
    if (!keyed) {
      keyed = new Map();
      this.actors.set(definition.id, keyed);
    }
    const existing = keyed.get(key) as
      | HostedActor<Key, State, Event, Command, Reason>
      | undefined;
    if (existing) return existing;
    const actor = new HostedActor(
      definition,
      key,
      this.options,
      (disposedActor) => {
        if (keyed?.get(key) === disposedActor) keyed.delete(key);
        if (keyed?.size === 0) this.actors.delete(definition.id);
      },
    );
    keyed.set(key, actor);
    return actor;
  }

  private assertRegistered(definition: { readonly id: string }): void {
    if (this.definitions.get(definition.id) !== definition) {
      throw new Error(`Machine ${definition.id} is not registered`);
    }
  }

  private definition(machineId: string): AnyDefinition {
    const definition = this.definitions.get(machineId);
    if (!definition) throw new Error(`Machine ${machineId} is not registered`);
    return definition;
  }

  private async disposeActors(
    actors: readonly HostedActor<any, any, any, any, any>[],
    cause: ActorDisposalCause,
  ): Promise<void> {
    const results = await Promise.allSettled(
      actors.map((actor) => actor.dispose(cause)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "ActorHost disposal failed");
    }
  }
}
