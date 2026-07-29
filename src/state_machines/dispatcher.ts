import { SnapshotStore } from "./snapshot_store";
import { validateTransitionResult } from "./transition_validation";
import type {
  DispatchContext,
  IgnoreReason,
  TransitionObserver,
  TransitionResult,
} from "./types";

export type DispatcherErrorStage =
  | "transition"
  | "validation"
  | "before-commit"
  | "projection"
  | "subscriber"
  | "observer"
  | "outcome"
  | "scheduler"
  | "command"
  | "command-error-mapper";

export interface DispatcherError<Command = unknown> {
  readonly stage: DispatcherErrorStage;
  readonly error: unknown;
  readonly command?: Command;
}

export type DispatchTicketOutcome<State, Reason extends IgnoreReason> =
  | {
      readonly kind: "applied";
      readonly state: State;
    }
  | {
      readonly kind: "ignored";
      readonly state: State;
      readonly reason: Reason;
    }
  | {
      readonly kind: "failed";
      readonly stage: "transition" | "validation" | "before-admission";
      readonly error: unknown;
    }
  | {
      readonly kind: "disposed";
    };

export interface DispatchTicket<State, Reason extends IgnoreReason> {
  readonly settled: Promise<DispatchTicketOutcome<State, Reason>>;
}

interface PendingDispatch<State, Event> {
  readonly event: Event;
  readonly dispatchContext?: DispatchContext;
  readonly onSettled?: (
    outcome: DispatchTicketOutcome<State, IgnoreReason>,
  ) => void;
  readonly settle: (
    outcome: DispatchTicketOutcome<State, IgnoreReason>,
  ) => void;
}

export interface ReservedCommandBatch<Command> {
  readonly sequence: number;
  readonly commands: readonly Command[];
}

export interface TransitionOutcomePublisher<Outcome> {
  (outcome: Outcome): unknown;
  /**
   * Optional atomic publication hook. Correlated registries use this to mark
   * every committed outcome terminal before any settlement listener reenters.
   */
  publishBatch?(outcomes: readonly Outcome[]): unknown;
}

export type CommandExecutor<Command> = (command: Command) => Promise<void>;

/**
 * Domain policy for starting reserved command batches. The dispatcher calls
 * this exactly once per applied event, in event order, after notification.
 * The scheduler decides whether and when commands run serially or concurrently.
 */
export interface CommandScheduler<Command> {
  schedule(
    batch: ReservedCommandBatch<Command>,
    execute: CommandExecutor<Command>,
  ): void | Promise<void>;
}

export interface TransactionalDispatcherOptions<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
  Outcome = never,
> {
  initialState: State;
  transition(
    state: State,
    event: Event,
  ): TransitionResult<State, Command, Reason, Outcome>;
  runCommand(
    command: Command,
    emit: (event: Event) => void,
  ): void | Promise<void>;
  scheduler: CommandScheduler<Command>;
  /**
   * Runs after validation and reservation but immediately before commit.
   * This narrow hook exists for cancelling state-owned leases before the old
   * state exits. It must not start commands or publish application state.
   *
   * A throw is reported but does not veto commit: this effectful hook may
   * already have partially completed, so pretending to reject atomically
   * would instead drop the event against a partially modified old state.
   * Domains must also reject stale callbacks by operation/state-instance token.
   */
  beforeCommit?(previous: State, next: State): void;
  project?(snapshot: State): void;
  observer?: TransitionObserver<State, Event, Command, Reason>;
  /**
   * Publishes explicit transition outcomes after the authoritative snapshot
   * commit. Failures are isolated and cannot roll back the transition.
   */
  publishOutcome?: TransitionOutcomePublisher<Outcome>;
  mapUnexpectedCommandError?(
    command: Command,
    error: unknown,
  ): Event | undefined;
  reportError?(error: DispatcherError<Command>): void;
}

/**
 * Policy-free event transaction runtime.
 *
 * Each admitted event runs transition and validation once, reserves a command
 * batch without invoking domain code, commits, projects, publishes correlated
 * outcomes, notifies subscribers and observers, and only then asks the injected
 * scheduler to start the batch. Re-entrant sends append to the same FIFO.
 */
export class TransactionalDispatcher<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
  Outcome = never,
> {
  private readonly pendingEvents: PendingDispatch<State, Event>[] = [];
  private readonly store: SnapshotStore<State>;
  private processing = false;
  private accepting = true;
  private disposed = false;
  private nextBatchSequence = 1;

  constructor(
    private readonly options: TransactionalDispatcherOptions<
      State,
      Event,
      Command,
      Reason,
      Outcome
    >,
  ) {
    if (
      options.publishOutcome?.constructor.name === "AsyncFunction" ||
      options.publishOutcome?.publishBatch?.constructor.name === "AsyncFunction"
    ) {
      throw new Error(
        "Transition outcome publisher must be synchronous and non-thenable",
      );
    }
    this.store = new SnapshotStore(options.initialState);
  }

  getSnapshot = (): State => this.store.getSnapshot();

  subscribe = (subscriber: () => void): (() => void) => {
    if (!this.accepting) return () => undefined;
    return this.store.subscribe(() => {
      try {
        subscriber();
      } catch (error) {
        this.report({ stage: "subscriber", error });
      }
    });
  };

  enqueue = (
    event: Event,
    onSettled?: (outcome: DispatchTicketOutcome<State, Reason>) => void,
    dispatchContext?: DispatchContext,
  ): DispatchTicket<State, Reason> => {
    let settle!: (outcome: DispatchTicketOutcome<State, Reason>) => void;
    const settled = new Promise<DispatchTicketOutcome<State, Reason>>(
      (resolve) => {
        settle = resolve;
      },
    );
    const ticket = { settled };
    if (!this.accepting) {
      settle({ kind: "disposed" });
      return ticket;
    }
    this.pendingEvents.push({
      event,
      dispatchContext,
      onSettled: onSettled as
        | ((outcome: DispatchTicketOutcome<State, IgnoreReason>) => void)
        | undefined,
      settle: (outcome) =>
        settle(outcome as DispatchTicketOutcome<State, Reason>),
    });
    if (this.processing) return ticket;
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        if (!this.accepting) {
          next.settle({ kind: "disposed" });
          break;
        }
        this.processOne(next);
      }
    } finally {
      this.processing = false;
      if (!this.accepting) this.settlePendingAsDisposed();
    }
    return ticket;
  };

  send = (event: Event, dispatchContext?: DispatchContext): void => {
    void this.enqueue(event, undefined, dispatchContext);
  };

  /**
   * Starts a domain-owned finalizer batch through the same guarded executor.
   * This is intended for controller disposal, not normal event processing.
   */
  startFinalizers(commands: readonly Command[]): void {
    if (commands.length === 0) return;
    this.startBatch(this.reserve(commands), this.executeFinalizer);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopAdmission();
    this.disposed = true;
    this.store.dispose();
  }

  /**
   * Stops new events and settles queued entries while preserving the current
   * snapshot and subscriptions for an owner's ordered disposal projection.
   */
  stopAdmission(): void {
    if (!this.accepting) return;
    this.accepting = false;
    if (!this.processing) this.settlePendingAsDisposed();
  }

  isAccepting(): boolean {
    return this.accepting;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private processOne({
    event,
    dispatchContext,
    onSettled,
    settle,
  }: PendingDispatch<State, Event>): void {
    const settleCurrent = (
      outcome: DispatchTicketOutcome<State, Reason>,
    ): void => {
      onSettled?.(outcome);
      settle(outcome);
    };
    const previous = this.store.getSnapshot();
    let result: TransitionResult<State, Command, Reason, Outcome>;
    try {
      result = this.options.transition(previous, event);
    } catch (error) {
      this.report({ stage: "transition", error });
      settleCurrent({ kind: "failed", stage: "transition", error });
      return;
    }

    try {
      validateTransitionResult(previous, event, result);
    } catch (error) {
      this.report({ stage: "validation", error });
      settleCurrent({ kind: "failed", stage: "validation", error });
      return;
    }

    if (result.kind === "ignored") {
      this.notifyObserver(previous, event, result, dispatchContext);
      settleCurrent({
        kind: "ignored",
        state: this.store.getSnapshot(),
        reason: result.reason,
      });
      return;
    }

    // Reservation is deliberately data-only: no scheduler or adapter code.
    const batch = this.reserve(result.commands);
    const outcomes = Object.freeze([...(result.outcomes ?? [])]);
    try {
      this.options.beforeCommit?.(previous, result.state);
    } catch (error) {
      this.report({ stage: "before-commit", error });
    }
    if (!this.accepting) {
      settleCurrent({ kind: "disposed" });
      return;
    }

    // Linearization point. Every callback below reads this committed snapshot.
    if (result.state === previous) {
      this.project(result.state);
      this.publishOutcomes(outcomes);
    } else {
      this.store.setState(result.state, () => {
        this.project(result.state);
        // SetState has committed before this callback and has not notified
        // subscribers yet. Authoritative settlement therefore wins over
        // teardown reentered by snapshot/observer callbacks.
        this.publishOutcomes(outcomes);
      });
    }

    this.notifyObserver(previous, event, result, dispatchContext);
    if (this.accepting) this.startBatch(batch);
    settleCurrent({ kind: "applied", state: this.store.getSnapshot() });
  }

  private reserve(commands: readonly Command[]): ReservedCommandBatch<Command> {
    return Object.freeze({
      sequence: this.nextBatchSequence++,
      commands: Object.freeze([...commands]),
    });
  }

  private startBatch(
    batch: ReservedCommandBatch<Command>,
    execute: CommandExecutor<Command> = this.executeCommand,
  ): void {
    try {
      const scheduled = this.options.scheduler.schedule(batch, execute);
      void Promise.resolve(scheduled).catch((error) => {
        this.report({ stage: "scheduler", error });
      });
    } catch (error) {
      this.report({ stage: "scheduler", error });
    }
  }

  private executeCommand: CommandExecutor<Command> = async (command) => {
    if (!this.accepting) return;
    await this.runGuardedCommand(command, this.send, true);
  };

  private executeFinalizer: CommandExecutor<Command> = async (command) => {
    await this.runGuardedCommand(command, () => undefined, false);
  };

  private async runGuardedCommand(
    command: Command,
    emit: (event: Event) => void,
    mapUnexpectedError: boolean,
  ): Promise<void> {
    try {
      await this.options.runCommand(command, emit);
    } catch (error) {
      this.report({ stage: "command", error, command });
      if (!mapUnexpectedError || !this.options.mapUnexpectedCommandError) {
        return;
      }
      try {
        const event = this.options.mapUnexpectedCommandError(command, error);
        if (event !== undefined) this.send(event);
      } catch (mappingError) {
        this.report({
          stage: "command-error-mapper",
          error: mappingError,
          command,
        });
      }
    }
  }

  private notifyObserver(
    previous: State,
    event: Event,
    result: TransitionResult<State, Command, Reason, Outcome>,
    dispatchContext?: DispatchContext,
  ): void {
    try {
      if (result.kind === "ignored") {
        this.options.observer?.onEventIgnored?.({
          state: this.store.getSnapshot(),
          event,
          reason: result.reason,
          ...(dispatchContext ? { dispatchContext } : {}),
        });
      } else {
        this.options.observer?.onTransitionApplied?.({
          previous,
          event,
          state: this.store.getSnapshot(),
          commands: result.commands,
          ...(dispatchContext ? { dispatchContext } : {}),
        });
      }
    } catch (error) {
      this.report({ stage: "observer", error });
    }
  }

  private publishOutcomes(outcomes: readonly Outcome[]): void {
    if (!this.options.publishOutcome) return;
    if (this.options.publishOutcome.publishBatch) {
      try {
        this.rejectThenableOutcomePublication(
          this.options.publishOutcome.publishBatch(outcomes),
        );
      } catch (error) {
        this.report({ stage: "outcome", error });
      }
      return;
    }
    for (const outcome of outcomes) {
      try {
        this.rejectThenableOutcomePublication(
          this.options.publishOutcome(outcome),
        );
      } catch (error) {
        this.report({ stage: "outcome", error });
      }
    }
  }

  private rejectThenableOutcomePublication(published: unknown): void {
    if (
      ((typeof published === "object" && published !== null) ||
        typeof published === "function") &&
      "then" in published
    ) {
      void Promise.resolve(published).catch((error) => {
        this.report({ stage: "outcome", error });
      });
      this.report({
        stage: "outcome",
        error: new Error(
          "Transition outcome publisher must be synchronous and non-thenable",
        ),
      });
    }
  }

  private project(snapshot: State): void {
    if (!this.options.project) return;
    try {
      this.options.project(snapshot);
    } catch (error) {
      this.report({ stage: "projection", error });
    }
  }

  private report(error: DispatcherError<Command>): void {
    if (!this.options.reportError) {
      console.error(
        `State-machine dispatcher ${error.stage} failure:`,
        error.error,
      );
      return;
    }
    try {
      this.options.reportError(error);
    } catch {
      // Error reporting must never become another queue failure.
    }
  }

  private settlePendingAsDisposed(): void {
    for (
      let pending = this.pendingEvents.shift();
      pending !== undefined;
      pending = this.pendingEvents.shift()
    ) {
      pending.settle({ kind: "disposed" });
    }
  }
}
