import {
  TransactionalDispatcher,
  type CommandExecutor,
  type CommandScheduler,
  type DispatchTicketOutcome,
  type DispatcherError,
  type ReservedCommandBatch,
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
  ActorEventSink,
  HostedActorRef,
  MachineHostContext,
} from "./definition";
import {
  KeyedAdmissionGate,
  KeyedAdmissionGateError,
  type FenceHandle,
  type KeyedAdmissionGeneration,
} from "./keyed_admission_gate";

type AnyDefinition = DistributedMachineDefinition<
  string,
  unknown,
  unknown,
  unknown,
  unknown,
  IgnoreReason,
  unknown,
  any
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
      | "machine-disposing"
      | "key-fenced"
      | "stale-admission-generation"
      | "stale-actor-revision"
      | "untracked-command-completion",
    message: string,
  ) {
    super(message);
    this.name = "ActorAdmissionError";
  }
}

export interface ActorMachineFenceHandle {
  seal(): Promise<void>;
  commit(): boolean;
  abort(): boolean;
  release(): boolean;
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

export interface ActorHostAdmissionGeneration {
  readonly host: number;
  readonly machine: number;
  readonly gate: KeyedAdmissionGeneration;
}

interface EventContinuation {
  readonly generation: KeyedAdmissionGeneration;
  readonly settled: Promise<void>;
  observeBatch(commandCount: number): void;
  observeTicket(outcome: DispatchTicketOutcome<unknown, IgnoreReason>): void;
  observeCommandStart(): void;
  observeCommandSettlement(): void;
  observeSchedulerFailure(): void;
}

function createEventContinuation(
  generation: KeyedAdmissionGeneration,
): EventContinuation {
  let resolve!: () => void;
  const settled = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  let ticketSettled = false;
  let batchObserved = false;
  let schedulerFailed = false;
  let expectedCommands = 0;
  let startedCommands = 0;
  let settledCommands = 0;
  const reconcile = () => {
    if (
      ticketSettled &&
      ((schedulerFailed && settledCommands === startedCommands) ||
        (batchObserved && settledCommands === expectedCommands))
    ) {
      resolve();
    }
  };
  return {
    generation,
    settled,
    observeBatch(commandCount) {
      batchObserved = true;
      expectedCommands = commandCount;
      reconcile();
    },
    observeTicket(outcome) {
      ticketSettled = true;
      if (outcome.kind !== "applied") batchObserved = true;
      reconcile();
    },
    observeCommandStart() {
      startedCommands += 1;
    },
    observeCommandSettlement() {
      settledCommands += 1;
      reconcile();
    },
    observeSchedulerFailure() {
      schedulerFailed = true;
      reconcile();
    },
  };
}

interface HostedActorAdmission<Event> {
  capture(): KeyedAdmissionGeneration;
  isCreateAllowed(generation: KeyedAdmissionGeneration): boolean;
  markUntrackedCommandCompletion(): void;
  assertDispatch(
    event: Event,
    generation: KeyedAdmissionGeneration,
    captured: boolean,
  ): void;
  track<Result>(
    generation: KeyedAdmissionGeneration,
    start: () => Promise<Result>,
  ): Promise<Result>;
}

interface CapturedSinkState {
  expectedActor: ActorRuntimeMetadata;
}

class HostedActor<
  Key,
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
  Outcome = any,
> implements HostedActorRef<State, Event, Reason> {
  readonly kind = "local" as const;
  readonly actorInstanceId: ActorInstanceId;
  private readonly tasks = new TaskScope<PropertyKey>();
  private readonly timers: TimerLeaseScope<PropertyKey, unknown, Event>;
  private readonly dispatcher: TransactionalDispatcher<
    State,
    Event,
    Command,
    Reason,
    Outcome
  >;
  private revision = 0;
  private transactionSequence = 0;
  private subscriberCount = 0;
  private readonly bufferedEvents: {
    readonly event: Event;
    readonly generation?: KeyedAdmissionGeneration;
    readonly sinkState?: CapturedSinkState;
  }[] = [];
  private readonly pendingContinuations: EventContinuation[] = [];
  private currentContinuation: EventContinuation | undefined;
  private startingCommandGeneration: KeyedAdmissionGeneration | undefined;
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
      Reason,
      any,
      Outcome
    >,
    readonly key: Key,
    private readonly options: ActorHostOptions,
    private readonly admission: HostedActorAdmission<Event>,
    private readonly isAdmissionClosed: () => boolean,
    private readonly removeFromHost: (
      actor: HostedActor<Key, State, Event, Command, Reason, Outcome>,
    ) => void,
    private readonly notifyDisposed: (event: ActorDisposedEvent) => void,
  ) {
    this.actorInstanceId = options.ids.next(`${definition.id}-actor`);
    const initialState = definition.initialState(key);
    this.lastProjectedSnapshot = initialState;
    this.timers = new TimerLeaseScope(options.clock);

    let dispatcher:
      | TransactionalDispatcher<State, Event, Command, Reason, Outcome>
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
          this.bufferedEvents.push({ event });
        }
      },
      captureSink: (options) =>
        this.captureSinkForGeneration(undefined, options?.revisionPolicy),
    };
    try {
      const domainObserver = definition.createObserver?.(context);
      const beforeCommit = definition.createBeforeCommit?.(context);
      const publishOutcome = definition.createOutcomePublisher?.(context);
      const runCommand = definition.createCommandRunner(context);
      const scheduler = definition.createScheduler(key);
      const traceObserver = createTraceObserver<State, Event, Command, Reason>(
        definition.id,
        typeof key === "string" || typeof key === "number" ? key : String(key),
      );

      dispatcher = new TransactionalDispatcher({
        initialState,
        transition: (state, event) => {
          this.currentContinuation = this.pendingContinuations.shift();
          this.transactionSequence += 1;
          return definition.transition(state, event, key);
        },
        scheduler: this.trackScheduler(scheduler),
        runCommand: (command) => {
          const generation =
            this.startingCommandGeneration ?? this.admission.capture();
          const sink = this.captureSinkForGeneration(
            generation,
            definition.commandSinkRevisionPolicy,
          );
          const execution = runCommand(command, sink.send);
          if (
            execution === undefined ||
            typeof (execution as PromiseLike<void>).then !== "function"
          ) {
            // A legacy runner that returns void may have completed
            // synchronously or may have handed off detached work. The host
            // cannot distinguish those cases, so destructive fencing must
            // fail closed until the definition adopts promise completion.
            this.admission.markUntrackedCommandCompletion();
          }
          return execution;
        },
        beforeCommit,
        project: (snapshot) => {
          if (snapshot !== this.lastProjectedSnapshot) {
            this.lastProjectedSnapshot = snapshot;
            this.revision += 1;
          }
        },
        observer: composeObservers([traceObserver, domainObserver]),
        publishOutcome,
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
  ): ActorDispatchTicket<State, Reason> =>
    this.enqueueWithAdmission(
      event,
      dispatchContext,
      this.admission.capture(),
      false,
    );

  private enqueueWithAdmission(
    event: Event,
    dispatchContext: DispatchContext | undefined,
    generation: KeyedAdmissionGeneration,
    captured: boolean,
    expectedActor?: ActorRuntimeMetadata,
    onSettledMetadata?: (metadata: ActorRuntimeMetadata) => void,
  ): ActorDispatchTicket<State, Reason> {
    try {
      this.admission.assertDispatch(event, generation, captured);
    } catch (error) {
      if (!(error instanceof KeyedAdmissionGateError)) throw error;
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          error.code === "stale-generation"
            ? "stale-admission-generation"
            : "key-fenced",
          error.message,
        ),
      });
    }
    if (
      expectedActor &&
      (expectedActor.actorInstanceId !== this.actorInstanceId ||
        expectedActor.snapshotRevision !== this.getMetadata().snapshotRevision)
    ) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "stale-actor-revision",
          `Actor ${this.definition.id} changed after the producer sink was captured`,
        ),
      });
    }
    if (this.isAdmissionClosed()) this.stopAdmission();
    if (!this.dispatcher.isAccepting()) {
      return settledTicket({ kind: "disposed" });
    }
    const continuation = createEventContinuation(generation);
    this.pendingContinuations.push(continuation);
    try {
      void this.admission
        .track(generation, () => continuation.settled)
        .catch((failure) => this.reportFailure(failure));
    } catch (error) {
      this.pendingContinuations.pop();
      if (!(error instanceof KeyedAdmissionGateError)) throw error;
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          error.code === "stale-generation"
            ? "stale-admission-generation"
            : "key-fenced",
          error.message,
        ),
      });
    }
    let settledMetadata: ActorRuntimeMetadata | undefined;
    const ticket = this.dispatcher.enqueue(
      event,
      () => {
        settledMetadata = this.getMetadata();
        onSettledMetadata?.(settledMetadata);
      },
      dispatchContext,
    );
    void ticket.settled
      .then((outcome) => {
        this.removePendingContinuation(continuation);
        continuation.observeTicket(
          outcome as DispatchTicketOutcome<unknown, IgnoreReason>,
        );
        if (outcome.kind !== "disposed") this.reconcileRetention();
      })
      .catch((failure) => this.reportFailure(failure));
    return {
      settled: ticket.settled,
      getSettledMetadata: () => settledMetadata,
    };
  }

  captureSink(options?: {
    readonly revisionPolicy?: "captured" | "allow-advance";
  }): ActorEventSink<Event> {
    return this.captureSinkForGeneration(undefined, options?.revisionPolicy);
  }

  private captureSinkForGeneration(
    generation: KeyedAdmissionGeneration = this.admission.capture(),
    revisionPolicy: "captured" | "allow-advance" = "captured",
  ): ActorEventSink<Event> {
    const actor = this.getMetadata();
    const sinkState: CapturedSinkState = { expectedActor: actor };
    return Object.freeze({
      actor,
      admissionGeneration: generation,
      send: (event: Event) => {
        const dispatcher = this.dispatcher as
          | TransactionalDispatcher<State, Event, Command, Reason, Outcome>
          | undefined;
        if (!dispatcher) {
          this.bufferedEvents.push({
            event,
            generation,
            sinkState,
          });
          return;
        }
        const advanceExpectedActor = (settled?: ActorRuntimeMetadata) => {
          if (
            settled?.actorInstanceId ===
              sinkState.expectedActor.actorInstanceId &&
            settled.snapshotRevision >= sinkState.expectedActor.snapshotRevision
          ) {
            sinkState.expectedActor = settled;
          }
        };
        const ticket = this.enqueueWithAdmission(
          event,
          undefined,
          generation,
          true,
          revisionPolicy === "allow-advance"
            ? {
                ...sinkState.expectedActor,
                snapshotRevision: this.getMetadata().snapshotRevision,
              }
            : sinkState.expectedActor,
          advanceExpectedActor,
        );
        // The dispatcher normally settles synchronously. The Promise path also
        // covers a producer emission queued behind hostile synchronous reentry.
        advanceExpectedActor(ticket.getSettledMetadata());
        void ticket.settled.then(() =>
          advanceExpectedActor(ticket.getSettledMetadata()),
        );
      },
    });
  }

  /**
   * Enrolls externally initiated work under the exact actor/gate lifetime
   * captured by a non-creating sink so destructive fences drain it.
   */
  trackCaptured<Result>(
    sink: ActorEventSink<Event>,
    start: () => Promise<Result>,
  ): Promise<Result> {
    const current = this.getMetadata();
    if (
      current.actorInstanceId !== sink.actor.actorInstanceId ||
      current.snapshotRevision !== sink.actor.snapshotRevision
    ) {
      throw new ActorAdmissionError(
        "stale-actor-revision",
        "Captured external work does not target the current actor revision",
      );
    }
    return this.admission.track(sink.admissionGeneration, start);
  }

  private trackScheduler(
    scheduler: CommandScheduler<Command>,
  ): CommandScheduler<Command> {
    return {
      schedule: (
        batch: ReservedCommandBatch<Command>,
        execute: CommandExecutor<Command>,
      ) => {
        const continuation = this.currentContinuation;
        if (!continuation) return scheduler.schedule(batch, execute);
        continuation.observeBatch(batch.commands.length);
        let acceptingExecutions = true;
        const trackedExecute: CommandExecutor<Command> = async (command) => {
          if (!acceptingExecutions) return;
          let execution: Promise<void>;
          continuation.observeCommandStart();
          this.startingCommandGeneration = continuation.generation;
          try {
            execution = execute(command);
          } finally {
            this.startingCommandGeneration = undefined;
          }
          try {
            await execution;
          } finally {
            continuation.observeCommandSettlement();
          }
        };
        try {
          const scheduled = scheduler.schedule(batch, trackedExecute);
          if (!scheduled) return;
          return Promise.resolve(scheduled).catch((failure) => {
            acceptingExecutions = false;
            continuation.observeSchedulerFailure();
            throw failure;
          });
        } catch (failure) {
          acceptingExecutions = false;
          continuation.observeSchedulerFailure();
          throw failure;
        }
      },
    };
  }

  private removePendingContinuation(continuation: EventContinuation): void {
    const index = this.pendingContinuations.indexOf(continuation);
    if (index !== -1) this.pendingContinuations.splice(index, 1);
  }

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

  enqueueExpectedCaptured(
    event: Event,
    generation: KeyedAdmissionGeneration,
    expectedActor: ActorRuntimeMetadata,
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason> {
    if (expectedActor.actorInstanceId !== this.actorInstanceId) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "stale-actor-instance",
          `Actor ${this.definition.id} was recreated`,
        ),
      });
    }
    return this.enqueueWithAdmission(
      event,
      dispatchContext,
      generation,
      true,
      expectedActor,
    );
  }

  stopAdmission(): void {
    this.dispatcher.stopAdmission();
    this.cancelRetentionTimers((failure) =>
      this.admissionStopErrors.push(failure),
    );
  }

  activate(constructionGeneration: KeyedAdmissionGeneration): void {
    const bufferedEvents = this.bufferedEvents.splice(0);
    for (const buffered of bufferedEvents) {
      // Factory-time events belong to construction admission, not to cleanup
      // drain admission. If construction crossed a fence, suppress them all;
      // the host's final create recheck will dispose the actor.
      if (!this.admission.isCreateAllowed(constructionGeneration)) break;
      if (buffered.generation) {
        const advanceExpectedActor = (settled: ActorRuntimeMetadata) => {
          if (
            buffered.sinkState &&
            settled.actorInstanceId ===
              buffered.sinkState.expectedActor.actorInstanceId &&
            settled.snapshotRevision >=
              buffered.sinkState.expectedActor.snapshotRevision
          ) {
            buffered.sinkState.expectedActor = settled;
          }
        };
        void this.enqueueWithAdmission(
          buffered.event,
          undefined,
          buffered.generation,
          true,
          buffered.sinkState?.expectedActor,
          advanceExpectedActor,
        );
      } else {
        void this.enqueue(buffered.event);
      }
    }
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
  private readonly admissionGates = new Map<
    string,
    KeyedAdmissionGate<unknown, unknown>
  >();
  private readonly untrackedCommandKeys = new Map<string, Set<unknown>>();
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
  private readonly machineAdmissionFences = new Map<
    string,
    {
      readonly handles: readonly FenceHandle<unknown>[];
      phase: "draining" | "sealed" | "committed";
    }
  >();
  private readonly machineConstructionDisposals = new Map<
    string,
    Promise<void>[]
  >();
  private readonly hostConstructionDisposals: Promise<void>[] = [];
  private readonly machineLifecycleGenerations = new Map<string, number>();
  private hostLifecycleGeneration = 0;
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
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
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
    this.definitions.set(definition.id, definition as unknown as AnyDefinition);
    this.admissionGates.set(definition.id, new KeyedAdmissionGate());
    this.machineLifecycleGenerations.set(definition.id, 0);
    this.registeredDefinitions.add(definition);
  }

  captureAdmissionGeneration(
    machineId: string,
    key: unknown,
  ): ActorHostAdmissionGeneration {
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(machineId)) {
      this.throwMachineDisposing(machineId);
    }
    if (!this.definitions.has(machineId)) {
      throw new Error(`Machine ${machineId} is not registered`);
    }
    return {
      host: this.hostLifecycleGeneration,
      machine: this.machineLifecycleGenerations.get(machineId) ?? 0,
      gate: this.gate(machineId).captureGeneration(
        this.admissionKey(this.definition(machineId), key),
      ),
    };
  }

  isAdmissionGenerationCurrent(
    machineId: string,
    key: unknown,
    generation: ActorHostAdmissionGeneration,
  ): boolean {
    const definition = this.definitions.get(machineId);
    return (
      !this.disposed &&
      !this.machineDisposals.has(machineId) &&
      definition !== undefined &&
      generation.host === this.hostLifecycleGeneration &&
      generation.machine ===
        (this.machineLifecycleGenerations.get(machineId) ?? 0) &&
      this.gate(machineId).isGenerationCurrent(
        this.admissionKey(definition, key),
        generation.gate,
      )
    );
  }

  beginFence<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    options: {
      readonly key: Key;
      readonly allowDuringDrain: (event: NoInfer<Event>) => boolean;
    },
  ): FenceHandle<Key> {
    this.assertRegistered(definition);
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(definition.id)) {
      this.throwMachineDisposing(definition.id);
    }
    const admissionKey = this.admissionKey(definition, options.key);
    if (this.hasUntrackedCommandCompletion(definition.id, admissionKey)) {
      throw new ActorAdmissionError(
        "untracked-command-completion",
        `Actor ${definition.id} handed off command work without a completion promise`,
      );
    }
    const handle = this.gate(definition.id).beginFence({
      key: admissionKey,
      allowDuringDrain: options.allowDuringDrain as (event: unknown) => boolean,
    });
    return {
      key: options.key,
      generation: handle.generation,
      seal: async () => {
        await handle.seal();
        if (this.hasUntrackedCommandCompletion(definition.id, admissionKey)) {
          throw new ActorAdmissionError(
            "untracked-command-completion",
            `Actor ${definition.id} handed off command work without a completion promise`,
          );
        }
      },
      commit: handle.commit,
      abort: handle.abort,
      release: handle.release,
    };
  }

  /**
   * Publishes a machine-wide creation barrier and fences every currently
   * materialized key. This is the reset counterpart to beginFence().
   */
  beginMachineFence<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    options: {
      readonly allowDuringDrain: (event: Event) => boolean;
    },
  ): ActorMachineFenceHandle {
    this.assertRegistered(definition);
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (
      this.machineDisposals.has(definition.id) ||
      this.machineAdmissionFences.has(definition.id)
    ) {
      this.throwMachineDisposing(definition.id);
    }
    const record: {
      handles: FenceHandle<unknown>[];
      phase: "draining" | "sealed" | "committed";
    } = { handles: [], phase: "draining" };
    // Machine-fence publication linearization point: no await precedes it.
    this.machineAdmissionFences.set(definition.id, record);
    const keys = new Set<unknown>([
      ...(this.actors.get(definition.id)?.keys() ?? []),
      ...(this.constructing.get(definition.id) ?? []),
    ]);
    try {
      for (const key of keys) {
        const admissionKey = this.admissionKey(definition, key as Key);
        if (record.handles.some((handle) => handle.key === admissionKey)) {
          continue;
        }
        if (this.hasUntrackedCommandCompletion(definition.id, admissionKey)) {
          throw new ActorAdmissionError(
            "untracked-command-completion",
            `Actor ${definition.id} handed off command work without a completion promise`,
          );
        }
        record.handles.push(
          this.gate(definition.id).beginFence({
            key: admissionKey,
            allowDuringDrain: options.allowDuringDrain as (
              event: unknown,
            ) => boolean,
          }),
        );
      }
    } catch (error) {
      for (const handle of record.handles.reverse()) handle.abort();
      this.machineAdmissionFences.delete(definition.id);
      throw error;
    }
    return {
      seal: async () => {
        await Promise.all(record.handles.map((handle) => handle.seal()));
        record.phase = "sealed";
      },
      commit: () => {
        if (record.phase !== "sealed") {
          throw new Error("A machine fence must be sealed before commit");
        }
        const committed = record.handles.every((handle) => handle.commit());
        if (committed) record.phase = "committed";
        return committed;
      },
      abort: () => {
        if (record.phase === "committed") {
          throw new Error("A committed machine fence cannot abort");
        }
        if (this.machineAdmissionFences.get(definition.id) !== record) {
          return false;
        }
        for (const handle of record.handles) handle.abort();
        this.machineAdmissionFences.delete(definition.id);
        return true;
      },
      release: () => {
        if (record.phase !== "committed") {
          throw new Error("Only a committed machine fence can be released");
        }
        if (this.machineAdmissionFences.get(definition.id) !== record) {
          return false;
        }
        for (const handle of record.handles) handle.release();
        this.machineAdmissionFences.delete(definition.id);
        return true;
      },
    };
  }

  inspectAdmission(
    machineId: string,
    key: unknown,
  ): ReturnType<KeyedAdmissionGate<unknown, unknown>["inspect"]> {
    const definition = this.definition(machineId);
    return this.gate(machineId).inspect(this.admissionKey(definition, key));
  }

  ensure<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
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

  /**
   * Dispatches a trusted lifecycle event to every currently hosted actor for a
   * machine without creating or hydrating actors that are not already live.
   */
  dispatchExisting<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    eventForKey: (key: Key) => Event,
  ): readonly ActorDispatchTicket<State, Reason>[] {
    this.assertRegistered(definition);
    const actors = this.actors.get(definition.id);
    if (!actors) return [];
    return [...actors].map(([key, actor]) =>
      (
        actor as HostedActor<Key, State, Event, Command, Reason, Outcome>
      ).enqueue(eventForKey(key as Key)),
    );
  }

  localRef<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    key: Key,
  ): HostedActorRef<State, Event, Reason> {
    const generation = this.captureAdmissionGeneration(definition.id, key);
    return this.localRefCaptured(definition, key, generation);
  }

  /**
   * Final synchronous admission for a newly acquired actor reference prepared
   * across an asynchronous boundary. Existing actors are still subject to the
   * keyed creation/reference fence.
   */
  localRefCaptured<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    key: Key,
    generation: ActorHostAdmissionGeneration,
  ): HostedActorRef<State, Event, Reason> {
    this.assertRegistered(definition);
    if (!this.isAdmissionGenerationCurrent(definition.id, key, generation)) {
      throw new ActorAdmissionError(
        "stale-admission-generation",
        `Admission changed while acquiring ${definition.id}`,
      );
    }
    try {
      this.gate(definition.id).assertCreateAllowed(
        this.admissionKey(definition, key),
        generation.gate,
      );
    } catch (error) {
      this.throwGateAdmission(error);
    }
    if (this.isConstructionDisposing(definition.id, key)) {
      this.throwActorDisposing(definition.id);
    }
    const existing = this.actors.get(definition.id)?.get(key) as
      | HostedActor<Key, State, Event, Command, Reason, Outcome>
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
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
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
      | HostedActor<Key, State, Event, Command, Reason, Outcome>
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

  /**
   * Final synchronous admission for work prepared across an asynchronous
   * authorization boundary. This never creates an actor and dispatches against
   * the exact host, machine, key-fence, actor-instance, and actor-revision
   * identities captured by the caller.
   */
  dispatchCaptured<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    key: Key,
    event: Event,
    generation: ActorHostAdmissionGeneration,
    expectedActor: ActorRuntimeMetadata,
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason> {
    this.assertRegistered(definition);
    if (!this.isAdmissionGenerationCurrent(definition.id, key, generation)) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "stale-admission-generation",
          `Admission changed while dispatching ${definition.id}`,
        ),
      });
    }
    const actor = this.actors.get(definition.id)?.get(key) as
      | HostedActor<Key, State, Event, Command, Reason, Outcome>
      | undefined;
    if (!actor || actor.isDisposing()) {
      return settledTicket({
        kind: "failed",
        stage: "before-admission",
        error: new ActorAdmissionError(
          "stale-actor-instance",
          `Actor ${definition.id} no longer exists`,
        ),
      });
    }
    return actor.enqueueExpectedCaptured(
      event,
      generation.gate,
      expectedActor,
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
    this.machineLifecycleGenerations.set(
      machineId,
      (this.machineLifecycleGenerations.get(machineId) ?? 0) + 1,
    );
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
    this.hostLifecycleGeneration += 1;
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
      this.machineLifecycleGenerations.clear();
      this.machineAdmissionFences.clear();
      this.untrackedCommandKeys.clear();
      for (const gate of this.admissionGates.values()) gate.dispose();
      this.admissionGates.clear();
    }
  }

  private ensureRegistered<
    Id extends string,
    Key,
    State,
    Event,
    Command,
    Reason extends IgnoreReason,
    RemoteIntent,
    Outcome,
  >(
    definition: DistributedMachineDefinition<
      Id,
      Key,
      State,
      Event,
      Command,
      Reason,
      RemoteIntent,
      Outcome
    >,
    key: Key,
  ): HostedActor<Key, State, Event, Command, Reason, Outcome> {
    if (this.disposed) {
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(definition.id)) {
      this.throwMachineDisposing(definition.id);
    }
    if (this.machineAdmissionFences.has(definition.id)) {
      throw new ActorAdmissionError(
        "key-fenced",
        `Actor machine ${definition.id} is fenced`,
      );
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
      | HostedActor<Key, State, Event, Command, Reason, Outcome>
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
    const admissionGate = this.gate(definition.id);
    const admissionKey = this.admissionKey(definition, key);
    const constructionGeneration =
      admissionGate.captureGeneration(admissionKey);
    try {
      admissionGate.assertCreateAllowed(admissionKey, constructionGeneration);
    } catch (error) {
      this.throwGateAdmission(error);
    }
    let settleConstruction!: () => void;
    const constructionSettled = new Promise<void>((resolve) => {
      settleConstruction = resolve;
    });
    void admissionGate
      .trackCaptured(
        admissionKey,
        constructionGeneration,
        () => constructionSettled,
      )
      .catch((failure) => this.reportFailure(definition.id, key, failure));
    let constructing = this.constructing.get(definition.id);
    if (!constructing) {
      constructing = new Set();
      this.constructing.set(definition.id, constructing);
    }
    constructing.add(key);
    let actor: HostedActor<Key, State, Event, Command, Reason, Outcome>;
    try {
      actor = new HostedActor(
        definition,
        key,
        this.options,
        {
          capture: () => admissionGate.captureGeneration(admissionKey),
          isCreateAllowed: (generation) => {
            try {
              admissionGate.assertCreateAllowed(admissionKey, generation);
              return true;
            } catch (error) {
              if (!(error instanceof KeyedAdmissionGateError)) throw error;
              return false;
            }
          },
          markUntrackedCommandCompletion: () => {
            let keys = this.untrackedCommandKeys.get(definition.id);
            if (!keys) {
              keys = new Set();
              this.untrackedCommandKeys.set(definition.id, keys);
            }
            keys.add(admissionKey);
          },
          assertDispatch: (event, generation, captured) => {
            if (captured) {
              admissionGate.assertCapturedDispatchAllowed(
                admissionKey,
                event,
                generation,
              );
            } else {
              admissionGate.assertDispatchAllowed(
                admissionKey,
                event,
                generation,
              );
            }
          },
          track: (generation, start) =>
            admissionGate.trackCaptured(admissionKey, generation, start),
        },
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
      settleConstruction();
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
    try {
      admissionGate.assertCreateAllowed(admissionKey, constructionGeneration);
    } catch (error) {
      const cleanup = actor.dispose("explicit");
      void cleanup.then(settleConstruction, (failure) => {
        this.reportFailure(definition.id, key, failure);
        settleConstruction();
      });
      this.throwGateAdmission(error);
    }
    if (this.disposed) {
      settleConstruction();
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (machineConstructionDisposals) {
      settleConstruction();
      this.throwMachineDisposing(definition.id);
    }
    if (constructionDisposal) {
      settleConstruction();
      this.throwActorDisposing(definition.id);
    }
    keyed.set(key, actor);
    actor.activate(constructionGeneration);
    if (this.disposed) {
      settleConstruction();
      throw new ActorAdmissionError("host-disposed", "ActorHost is disposed");
    }
    if (this.machineDisposals.has(definition.id)) {
      settleConstruction();
      this.throwMachineDisposing(definition.id);
    }
    if (
      actor.isDisposing() ||
      this.isConstructionDisposing(definition.id, key)
    ) {
      settleConstruction();
      this.throwActorDisposing(definition.id);
    }
    try {
      admissionGate.assertCreateAllowed(admissionKey, constructionGeneration);
    } catch (error) {
      void actor.dispose("explicit").then(settleConstruction, (failure) => {
        this.reportFailure(definition.id, key, failure);
        settleConstruction();
      });
      this.throwGateAdmission(error);
    }
    settleConstruction();
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

  private throwGateAdmission(error: unknown): never {
    if (!(error instanceof KeyedAdmissionGateError)) throw error;
    throw new ActorAdmissionError(
      error.code === "stale-generation"
        ? "stale-admission-generation"
        : "key-fenced",
      error.message,
    );
  }

  private gate(machineId: string): KeyedAdmissionGate<unknown, unknown> {
    const gate = this.admissionGates.get(machineId);
    if (!gate) throw new Error(`Machine ${machineId} is not registered`);
    return gate;
  }

  private hasUntrackedCommandCompletion(
    machineId: string,
    admissionKey: unknown,
  ): boolean {
    return this.untrackedCommandKeys.get(machineId)?.has(admissionKey) === true;
  }

  private admissionKey<Key>(
    definition: {
      readonly remoteIntent?: { readonly keyToString: (key: Key) => string };
      readonly remote?: { readonly keyToString: (key: Key) => string };
    },
    key: Key,
  ): unknown {
    const keyToString =
      definition.remoteIntent?.keyToString ?? definition.remote?.keyToString;
    return keyToString ? keyToString(key) : key;
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
