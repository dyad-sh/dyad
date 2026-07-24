import { SnapshotStore } from "./snapshot_store";
import { validateTransitionResult } from "./transition_validation";
import type {
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
  | "scheduler"
  | "command"
  | "command-error-mapper";

export interface DispatcherError<Command = unknown> {
  readonly stage: DispatcherErrorStage;
  readonly error: unknown;
  readonly command?: Command;
}

export interface ReservedCommandBatch<Command> {
  readonly sequence: number;
  readonly commands: readonly Command[];
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
> {
  initialState: State;
  transition(
    state: State,
    event: Event,
  ): TransitionResult<State, Command, Reason>;
  runCommand(
    command: Command,
    emit: (event: Event) => void,
  ): void | Promise<void>;
  scheduler: CommandScheduler<Command>;
  /**
   * Runs after validation and reservation but immediately before commit.
   * This narrow hook exists for cancelling state-owned leases before the old
   * state exits. It must not start commands or publish application state.
   */
  beforeCommit?(previous: State, next: State): void;
  project?(snapshot: State): void;
  observer?: TransitionObserver<State, Event, Command, Reason>;
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
 * batch without invoking domain code, commits, projects, notifies subscribers,
 * notifies observers, and only then asks the injected scheduler to start the
 * batch. Re-entrant sends append to the same FIFO.
 */
export class TransactionalDispatcher<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
> {
  private readonly pendingEvents: Event[] = [];
  private readonly store: SnapshotStore<State>;
  private processing = false;
  private disposed = false;
  private nextBatchSequence = 1;

  constructor(
    private readonly options: TransactionalDispatcherOptions<
      State,
      Event,
      Command,
      Reason
    >,
  ) {
    this.store = new SnapshotStore(options.initialState);
  }

  getSnapshot = (): State => this.store.getSnapshot();

  subscribe = (subscriber: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    return this.store.subscribe(() => {
      try {
        subscriber();
      } catch (error) {
        this.report({ stage: "subscriber", error });
      }
    });
  };

  send = (event: Event): void => {
    if (this.disposed) return;
    this.pendingEvents.push(event);
    if (this.processing) return;
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        if (this.disposed) break;
        this.processOne(next);
      }
    } finally {
      this.processing = false;
      if (this.disposed) this.pendingEvents.length = 0;
    }
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
    this.disposed = true;
    this.pendingEvents.length = 0;
    this.store.dispose();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private processOne(event: Event): void {
    const previous = this.store.getSnapshot();
    let result: TransitionResult<State, Command, Reason>;
    try {
      result = this.options.transition(previous, event);
    } catch (error) {
      this.report({ stage: "transition", error });
      return;
    }

    try {
      validateTransitionResult(previous, event, result);
    } catch (error) {
      this.report({ stage: "validation", error });
      return;
    }

    if (result.kind === "ignored") {
      this.notifyObserver(previous, event, result);
      return;
    }

    // Reservation is deliberately data-only: no scheduler or adapter code.
    const batch = this.reserve(result.commands);
    try {
      this.options.beforeCommit?.(previous, result.state);
    } catch (error) {
      this.report({ stage: "before-commit", error });
    }

    // Linearization point. Every callback below reads this committed snapshot.
    if (result.state === previous) {
      this.project(result.state);
    } else {
      this.store.setState(result.state, () => this.project(result.state));
    }

    this.notifyObserver(previous, event, result);
    this.startBatch(batch);
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
    if (this.disposed) return;
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
    result: TransitionResult<State, Command, Reason>,
  ): void {
    try {
      if (result.kind === "ignored") {
        this.options.observer?.onEventIgnored?.({
          state: this.store.getSnapshot(),
          event,
          reason: result.reason,
        });
      } else {
        this.options.observer?.onTransitionApplied?.({
          previous,
          event,
          state: this.store.getSnapshot(),
          commands: result.commands,
        });
      }
    } catch (error) {
      this.report({ stage: "observer", error });
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
}
