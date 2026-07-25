import {
  TransactionalDispatcher,
  type DispatchTicketOutcome,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import { TaskScope, collectDisposalError } from "@/state_machines/task_scope";
import { TimerLeaseScope } from "@/state_machines/timer_lease";
import { createTraceObserver } from "@/state_machines/trace";
import type { Clock, ClockHandle, IdSource } from "@/state_machines/clock";
import type {
  DispatchContext,
  IgnoreReason,
  TransitionObserver,
} from "@/state_machines/types";
import type {
  ActorDisposalCause,
  ActorDispatchTicket,
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

export interface ActorDisposedEvent {
  readonly machineId: string;
  readonly key: unknown;
  readonly metadata: ActorRuntimeMetadata;
  readonly snapshot: unknown;
  readonly cause: ActorDisposalCause;
}

export class ActorAdmissionError extends Error {
  constructor(
    readonly code:
      | "dispatch-does-not-create"
      | "subscription-does-not-create"
      | "stale-actor-instance"
      | "host-disposed"
      | "actor-disposing"
      | "actor-constructing"
      | "machine-disposing",
    message: string,
  ) {
    super(message);
    this.name = "ActorAdmissionError";
  }
}

function settledTicket<State, Reason extends IgnoreReason>(
  outcome: DispatchTicketOutcome<State, Reason>,
): ActorDispatchTicket<State, Reason> {
  return {
    settled: Promise.resolve(outcome),
    getSettledMetadata: () => undefined,
  };
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

interface RetentionTimerLease {
  handle?: ClockHandle;
}

interface ConstructionDisposalBarrier {
  readonly cause: ActorDisposalCause;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (failure: unknown) => void;
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
  private readonly bufferedEvents: Event[] = [];
  private idleTimer: RetentionTimerLease | undefined;
  private terminalTimer: RetentionTimerLease | undefined;
  private readonly admissionStopErrors: unknown[] = [];
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
    private readonly isAdmissionClosed: () => boolean,
    private readonly removeFromHost: (
      actor: HostedActor<Key, State, Event, Command, Reason>,
    ) => void,
    private readonly notifyDisposed: (event: ActorDisposedEvent) => void,
  ) {
    this.actorInstanceId = options.ids.next(`${definition.id}-actor`);
    const initialState = definition.initialState(key);
    this.lastProjectedSnapshot = initialState;
    this.timers = new TimerLeaseScope(options.clock);

    let dispatcher:
      | TransactionalDispatcher<State, Event, Command, Reason>
      | undefined;
    const context: MachineHostContext<Key, State, Event> = {
      key,
      actorInstanceId: this.actorInstanceId,
      ids: options.ids,
      tasks: this.tasks,
      timers: this.timers,
      getMetadata: () => this.getMetadata(),
      getSnapshot: () => dispatcher?.getSnapshot() ?? initialState,
      send: (event) => {
        if (dispatcher) {
          void this.enqueue(event);
        } else {
          this.bufferedEvents.push(event);
        }
      },
    };
    try {
      const domainObserver = definition.createObserver?.(context);
      const beforeCommit = definition.createBeforeCommit?.(context);
      const runCommand = definition.createCommandRunner(context);
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
        runCommand: (command) => runCommand(command, context.send),
        beforeCommit,
        project: (snapshot) => {
          if (snapshot !== this.lastProjectedSnapshot) {
            this.lastProjectedSnapshot = snapshot;
            this.revision += 1;
          }
        },
        observer: composeObservers([traceObserver, domainObserver]),
        reportError: (failure) => this.reportFailure(failure),
      });
      this.dispatcher = dispatcher;
      if (this.isAdmissionClosed()) {
        this.dispatcher.stopAdmission();
      }
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      collectDisposalError(cleanupErrors, () => this.timers.dispose());
      collectDisposalError(cleanupErrors, () => this.tasks.dispose());
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `Actor ${definition.id} construction failed`,
        );
      }
      throw error;
    }
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
      if (this.subscriberCount === 0) {
        try {
          this.reconcileRetention();
        } catch (failure) {
          this.reportFailure(failure);
        }
      }
    };
  };

  send = (event: Event, dispatchContext?: DispatchContext): void => {
    void this.enqueue(event, dispatchContext);
  };

  enqueue = (
    event: Event,
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason> => {
    if (this.isAdmissionClosed()) this.stopAdmission();
    let settledMetadata: ActorRuntimeMetadata | undefined;
    const ticket = this.dispatcher.enqueue(
      event,
      () => {
        settledMetadata = this.getMetadata();
      },
      dispatchContext,
    );
    void ticket.settled
      .then((outcome) => {
        if (outcome.kind !== "disposed") this.reconcileRetention();
      })
      .catch((failure) => this.reportFailure(failure));
    return {
      settled: ticket.settled,
      getSettledMetadata: () => settledMetadata,
    };
  };

  enqueueExpected(
    event: Event,
    expectedActorInstanceId?: ActorInstanceId,
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason> {
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
    return this.enqueue(event, dispatchContext);
  }

  stopAdmission(): void {
    this.dispatcher.stopAdmission();
    this.cancelRetentionTimers((failure) =>
      this.admissionStopErrors.push(failure),
    );
  }

  activate(): void {
    const bufferedEvents = this.bufferedEvents.splice(0);
    for (const event of bufferedEvents) void this.enqueue(event);
    try {
      this.reconcileRetention();
    } catch (failure) {
      this.reportFailure(failure);
    }
  }

  isDisposing(): boolean {
    return this.disposing;
  }

  dispose(cause: ActorDisposalCause): Promise<void> {
    const disposal = this.reserveDisposal(cause);
    this.stopAdmission();
    return disposal;
  }

  reserveDisposal(cause: ActorDisposalCause): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposing = true;
    const context: ActorDisposalContext<Key, State> = {
      key: this.key,
      cause,
      metadata: this.getMetadata(),
      snapshot: this.getSnapshot(),
    };
    this.disposal = Promise.resolve()
      .then(() => this.finishDisposal(context))
      .finally(() => this.removeFromHost(this));
    return this.disposal;
  }

  private async finishDisposal(
    context: ActorDisposalContext<Key, State>,
  ): Promise<void> {
    const errors: unknown[] = [...this.admissionStopErrors];
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
    try {
      this.notifyDisposed({
        machineId: this.definition.id,
        key: this.key,
        metadata: context.metadata,
        snapshot: context.snapshot,
        cause: context.cause,
      });
    } catch (error) {
      errors.push(error);
    }
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
    if (
      policy.kind === "retain" ||
      this.disposing ||
      this.idleTimer !== undefined
    ) {
      return;
    }
    const lease: RetentionTimerLease = {};
    this.idleTimer = lease;
    let handle: ClockHandle;
    try {
      handle = this.options.clock.schedule(() => {
        if (this.idleTimer !== lease) return;
        this.idleTimer = undefined;
        if (this.subscriberCount === 0) {
          void this.dispose("idle").catch((failure) =>
            this.reportFailure(failure),
          );
        }
      }, policy.delayMs);
    } catch (failure) {
      if (this.idleTimer === lease) this.idleTimer = undefined;
      throw failure;
    }
    if (this.idleTimer !== lease) {
      this.cancelUnownedTimer(handle);
      return;
    }
    lease.handle = handle;
  }

  private scheduleTerminalDisposal(): void {
    const policy = this.definition.lifecycle.terminalRetention;
    this.cancelIdleEviction();
    if (policy.kind === "retain" || this.disposing) return;
    if (this.terminalTimer !== undefined) return;
    const lease: RetentionTimerLease = {};
    this.terminalTimer = lease;
    let handle: ClockHandle;
    try {
      handle = this.options.clock.schedule(() => {
        if (this.terminalTimer !== lease) return;
        this.terminalTimer = undefined;
        try {
          if (!this.definition.lifecycle.isTerminal?.(this.getSnapshot())) {
            this.reconcileRetention();
            return;
          }
        } catch (failure) {
          this.reportFailure(failure);
          return;
        }
        void this.dispose("terminal").catch((failure) =>
          this.reportFailure(failure),
        );
      }, policy.delayMs);
    } catch (failure) {
      if (this.terminalTimer === lease) this.terminalTimer = undefined;
      throw failure;
    }
    if (this.terminalTimer !== lease) {
      this.cancelUnownedTimer(handle);
      return;
    }
    lease.handle = handle;
  }

  private reconcileRetention(): void {
    if (this.disposing) return;
    if (this.definition.lifecycle.isTerminal?.(this.getSnapshot())) {
      this.scheduleTerminalDisposal();
      return;
    }
    this.cancelTerminalDisposal();
    if (this.subscriberCount === 0) this.scheduleIdleEviction();
  }

  private cancelIdleEviction(
    onError: (failure: unknown) => void = (failure) =>
      this.reportFailure(failure),
  ): void {
    if (this.idleTimer === undefined) return;
    const { handle } = this.idleTimer;
    this.idleTimer = undefined;
    if (handle === undefined) return;
    try {
      this.options.clock.cancel(handle);
    } catch (failure) {
      onError(failure);
    }
  }

  private cancelRetentionTimers(
    onError: (failure: unknown) => void = (failure) =>
      this.reportFailure(failure),
  ): void {
    this.cancelIdleEviction(onError);
    this.cancelTerminalDisposal(onError);
  }

  private cancelTerminalDisposal(
    onError: (failure: unknown) => void = (failure) =>
      this.reportFailure(failure),
  ): void {
    if (this.terminalTimer === undefined) return;
    const { handle } = this.terminalTimer;
    this.terminalTimer = undefined;
    if (handle === undefined) return;
    try {
      this.options.clock.cancel(handle);
    } catch (failure) {
      onError(failure);
    }
  }

  private cancelUnownedTimer(handle: ClockHandle): void {
    try {
      this.options.clock.cancel(handle);
    } catch (failure) {
      if (this.disposing) {
        this.admissionStopErrors.push(failure);
      } else {
        this.reportFailure(failure);
      }
    }
  }

  private reportFailure(failure: unknown): void {
    try {
      this.options.reportError?.({
        machineId: this.definition.id,
        key: this.key,
        failure,
      });
    } catch {
      // Failure reporting must not become another lifecycle failure.
    }
  }
}

export class ActorHost {
  private readonly definitions = new Map<string, AnyDefinition>();
  private readonly registeredDefinitions = new WeakSet<object>();
  private readonly constructing = new Map<string, Set<unknown>>();
  private readonly constructionDisposals = new Map<
    string,
    Map<unknown, ConstructionDisposalBarrier>
  >();
  private readonly actors = new Map<
    string,
    Map<unknown, HostedActor<any, any, any, any, any>>
  >();
  private readonly machineDisposals = new Map<string, Promise<void>>();
  private readonly machineConstructionDisposals = new Map<
    string,
    Promise<void>[]
  >();
  private readonly hostConstructionDisposals: Promise<void>[] = [];
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private readonly disposalListeners = new Set<
    (event: ActorDisposedEvent) => void
  >();

  constructor(private readonly options: ActorHostOptions) {}

  onActorDisposed(listener: (event: ActorDisposedEvent) => void): () => void {
    this.disposalListeners.add(listener);
    return () => this.disposalListeners.delete(listener);
  }

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
    if (
      definition.lifecycle.terminalRetention.kind === "dispose-after" &&
      !definition.lifecycle.isTerminal
    ) {
      throw new Error(
        `Machine ${definition.id} requires isTerminal for bounded terminal retention`,
      );
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Machine ${definition.id} is already registered`);
    }
    this.definitions.set(definition.id, definition as AnyDefinition);
    this.registeredDefinitions.add(definition);
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
    const actor = this.actors.get(machineId)?.get(key);
    return actor?.isDisposing() ? undefined : actor;
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
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(definition.id)) {
      this.throwMachineDisposing(definition.id);
    }
    if (this.isConstructionDisposing(definition.id, key)) {
      this.throwActorDisposing(definition.id);
    }
    const existing = this.actors.get(definition.id)?.get(key) as
      | HostedActor<Key, State, Event, Command, Reason>
      | undefined;
    if (existing) {
      if (existing.isDisposing()) this.throwActorDisposing(definition.id);
      return existing;
    }
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
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason> {
    this.assertRegistered(definition);
    if (this.disposed) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "host-disposed",
          "ActorHost is disposed",
        ),
      });
    }
    if (this.machineDisposals.has(definition.id)) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "machine-disposing",
          `Machine ${definition.id} is disposing`,
        ),
      });
    }
    if (this.isConstructionDisposing(definition.id, key)) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "actor-disposing",
          `Actor ${definition.id} is disposing`,
        ),
      });
    }
    let actor = this.actors.get(definition.id)?.get(key) as
      | HostedActor<Key, State, Event, Command, Reason>
      | undefined;
    if (actor?.isDisposing()) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "actor-disposing",
          `Actor ${definition.id} is disposing`,
        ),
      });
    }
    if (this.isConstructing(definition.id, key)) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "actor-constructing",
          `Actor ${definition.id} is constructing`,
        ),
      });
    }
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
      try {
        actor = this.ensureRegistered(definition, key);
      } catch (error) {
        if (!(error instanceof ActorAdmissionError)) throw error;
        return settledTicket({
          kind: "failed",
          stage: "before-admission",
          error,
        });
      }
    }
    return actor.enqueueExpected(
      event,
      expectedActorInstanceId,
      dispatchContext,
    );
  }

  async disposeKey(
    machineId: string,
    key: unknown,
    cause: ActorDisposalCause = "explicit",
  ): Promise<void> {
    const actor = this.actors.get(machineId)?.get(key);
    if (actor) {
      await actor.dispose(cause);
      return;
    }
    const existing = this.constructionDisposals.get(machineId)?.get(key);
    if (existing) {
      await existing.promise;
      return;
    }
    if (!this.isConstructing(machineId, key)) return;
    await this.reserveConstructionDisposal(machineId, key, cause).promise;
  }

  async entityDeleted(machineId: string, key: unknown): Promise<void> {
    const definition = this.definition(machineId);
    if (definition.lifecycle.entityDeletion === "dispose") {
      await this.disposeKey(machineId, key, "entity-deletion");
    }
  }

  disposeMachine(machineId: string): Promise<void> {
    const existing = this.machineDisposals.get(machineId);
    if (existing) return existing;
    let actors!: readonly HostedActor<any, any, any, any, any>[];
    const constructionDisposals: Promise<void>[] = [];
    let disposal!: Promise<void>;
    disposal = Promise.resolve()
      .then(() =>
        this.disposeActors(actors, "machine-disposal", constructionDisposals),
      )
      .finally(() => {
        if (this.machineDisposals.get(machineId) === disposal) {
          this.machineDisposals.delete(machineId);
          this.machineConstructionDisposals.delete(machineId);
        }
      });
    this.machineDisposals.set(machineId, disposal);
    this.machineConstructionDisposals.set(machineId, constructionDisposals);
    actors = [...(this.actors.get(machineId)?.values() ?? [])];
    for (const actor of actors) actor.reserveDisposal("machine-disposal");
    for (const actor of actors) actor.stopAdmission();
    return disposal;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    let actors!: readonly HostedActor<any, any, any, any, any>[];
    this.disposal = Promise.resolve().then(() =>
      this.finishHostDisposal(actors),
    );
    actors = [...this.actors.values()].flatMap((keyed) => [...keyed.values()]);
    for (const actor of actors) actor.reserveDisposal("shutdown");
    for (const actor of actors) actor.stopAdmission();
    return this.disposal;
  }

  private async finishHostDisposal(
    actors: readonly HostedActor<any, any, any, any, any>[],
  ): Promise<void> {
    try {
      await this.disposeActors(
        actors,
        "shutdown",
        this.hostConstructionDisposals,
      );
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
    if (this.machineDisposals.has(definition.id)) {
      this.throwMachineDisposing(definition.id);
    }
    if (this.isConstructionDisposing(definition.id, key)) {
      this.throwActorDisposing(definition.id);
    }
    let keyed = this.actors.get(definition.id);
    if (!keyed) {
      keyed = new Map();
      this.actors.set(definition.id, keyed);
    }
    const existing = keyed.get(key) as
      | HostedActor<Key, State, Event, Command, Reason>
      | undefined;
    if (existing) {
      if (existing.isDisposing()) this.throwActorDisposing(definition.id);
      return existing;
    }
    if (this.isConstructing(definition.id, key)) {
      throw new ActorAdmissionError(
        "actor-constructing",
        `Actor ${definition.id} is constructing`,
      );
    }
    let constructing = this.constructing.get(definition.id);
    if (!constructing) {
      constructing = new Set();
      this.constructing.set(definition.id, constructing);
    }
    constructing.add(key);
    let actor: HostedActor<Key, State, Event, Command, Reason>;
    try {
      actor = new HostedActor(
        definition,
        key,
        this.options,
        () =>
          this.disposed ||
          this.machineDisposals.has(definition.id) ||
          this.isConstructionDisposing(definition.id, key),
        (disposedActor) => {
          if (keyed?.get(key) === disposedActor) keyed.delete(key);
          if (keyed?.size === 0) this.actors.delete(definition.id);
        },
        (event) => {
          for (const listener of this.disposalListeners) {
            try {
              listener(event);
            } catch (failure) {
              this.reportFailure(definition.id, key, failure);
            }
          }
        },
      );
    } catch (error) {
      const constructionDisposal = this.constructionDisposals
        .get(definition.id)
        ?.get(key);
      if (constructionDisposal) {
        this.settleConstructionDisposal(
          definition.id,
          key,
          constructionDisposal,
          error,
          true,
        );
      }
      if (keyed.size === 0) this.actors.delete(definition.id);
      throw error;
    } finally {
      constructing.delete(key);
      if (constructing.size === 0) this.constructing.delete(definition.id);
    }
    const machineConstructionDisposals = this.machineConstructionDisposals.get(
      definition.id,
    );
    const constructionDisposal = this.constructionDisposals
      .get(definition.id)
      ?.get(key);
    if (this.disposed || machineConstructionDisposals || constructionDisposal) {
      const cleanup = actor.dispose(
        this.disposed
          ? "shutdown"
          : machineConstructionDisposals
            ? "machine-disposal"
            : constructionDisposal!.cause,
      );
      if (this.disposed) this.hostConstructionDisposals.push(cleanup);
      machineConstructionDisposals?.push(cleanup);
      if (constructionDisposal) {
        void cleanup.then(
          () =>
            this.settleConstructionDisposal(
              definition.id,
              key,
              constructionDisposal,
            ),
          (failure) =>
            this.settleConstructionDisposal(
              definition.id,
              key,
              constructionDisposal,
              failure,
              true,
            ),
        );
      }
    }
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (machineConstructionDisposals) {
      this.throwMachineDisposing(definition.id);
    }
    if (constructionDisposal) {
      this.throwActorDisposing(definition.id);
    }
    keyed.set(key, actor);
    actor.activate();
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(definition.id)) {
      this.throwMachineDisposing(definition.id);
    }
    if (
      actor.isDisposing() ||
      this.isConstructionDisposing(definition.id, key)
    ) {
      this.throwActorDisposing(definition.id);
    }
    return actor;
  }

  private throwActorDisposing(machineId: string): never {
    throw new ActorAdmissionError(
      "actor-disposing",
      `Actor ${machineId} is disposing`,
    );
  }

  private throwMachineDisposing(machineId: string): never {
    throw new ActorAdmissionError(
      "machine-disposing",
      `Machine ${machineId} is disposing`,
    );
  }

  private isConstructing(machineId: string, key: unknown): boolean {
    return this.constructing.get(machineId)?.has(key) === true;
  }

  private isConstructionDisposing(machineId: string, key: unknown): boolean {
    return this.constructionDisposals.get(machineId)?.has(key) === true;
  }

  private reserveConstructionDisposal(
    machineId: string,
    key: unknown,
    cause: ActorDisposalCause,
  ): ConstructionDisposalBarrier {
    let resolve!: () => void;
    let reject!: (failure: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const barrier = { cause, promise, resolve, reject };
    let keyed = this.constructionDisposals.get(machineId);
    if (!keyed) {
      keyed = new Map();
      this.constructionDisposals.set(machineId, keyed);
    }
    keyed.set(key, barrier);
    return barrier;
  }

  private settleConstructionDisposal(
    machineId: string,
    key: unknown,
    barrier: ConstructionDisposalBarrier,
    failure?: unknown,
    rejected = false,
  ): void {
    const keyed = this.constructionDisposals.get(machineId);
    if (keyed?.get(key) !== barrier) return;
    keyed.delete(key);
    if (keyed.size === 0) this.constructionDisposals.delete(machineId);
    if (rejected) {
      barrier.reject(failure);
    } else {
      barrier.resolve();
    }
  }

  private reportFailure(machineId: string, key: unknown, failure: unknown) {
    try {
      this.options.reportError?.({ machineId, key, failure });
    } catch {
      // Failure reporting must not become another lifecycle failure.
    }
  }

  private assertRegistered(definition: { readonly id: string }): void {
    if (this.definitions.get(definition.id) === definition) return;
    if (this.disposed && this.registeredDefinitions.has(definition)) return;
    throw new Error(`Machine ${definition.id} is not registered`);
  }

  private definition(machineId: string): AnyDefinition {
    const definition = this.definitions.get(machineId);
    if (!definition) throw new Error(`Machine ${machineId} is not registered`);
    return definition;
  }

  private async disposeActors(
    actors: readonly HostedActor<any, any, any, any, any>[],
    cause: ActorDisposalCause,
    additionalDisposals: readonly Promise<void>[] = [],
  ): Promise<void> {
    const results = await Promise.allSettled(
      actors.map((actor) => actor.dispose(cause)).concat(additionalDisposals),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "ActorHost disposal failed");
    }
  }
}
