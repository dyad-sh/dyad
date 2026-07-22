import type { RunCommandExecutor } from "./commands";
import type {
  RestartOptions,
  RunCommand,
  RunEvent,
  RunState,
  RunUrl,
} from "./state";
import { transition } from "./transition";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";

/**
 * User-level operations. The controller allocates a fresh runId epoch for
 * each; callers never see or pass runIds.
 */
export type RunOperationInput =
  | { type: "START"; startedAt: number }
  | { type: "RESTART"; startedAt: number; options: RestartOptions }
  | { type: "REBUILD"; startedAt: number }
  | { type: "STOP"; startedAt: number };

/**
 * Events produced by stdout parsing / IPC output subscriptions. They carry
 * no runId on the wire; the controller stamps PROXY_READY with the current
 * epoch when it arrives.
 */
export type RunProducerInput =
  | { type: "PROXY_READY"; url: RunUrl }
  | { type: "HMR_DETECTED" }
  | { type: "MANUAL_RELOAD" }
  | { type: "APP_EXIT"; exitCode: number | null; timestamp: number };

/** Completion events that carry the runId of the operation they belong to. */
const RUN_ID_TAGGED_EVENTS = new Set<RunEvent["type"]>([
  "RUN_IPC_RESOLVED",
  "RUN_IPC_FAILED",
  "STOP_IPC_RESOLVED",
  "STOP_IPC_FAILED",
  "RELOAD_DONE",
]);

export interface AppRunControllerOptions {
  appId: number;
  executor: RunCommandExecutor;
  /** Called after every state change (e.g. to publish atom projections). */
  onStateChange?: (state: RunState) => void;
  observer?: TransitionObserver<RunState, RunEvent, RunCommand>;
}

/**
 * Per-app run-state controller.
 *
 * - Owns the runId epoch: every dispatched operation increments it, and any
 *   completion event tagged with an older runId is dropped before it can
 *   become a transition (this is what kills the stale-`finally` stomping
 *   and the cached-proxy-line races).
 * - Executes commands serially per app. Commands report IPC settlement as
 *   events instead of blocking the queue, so a superseding operation is
 *   never stuck behind its predecessor's in-flight spawn.
 * - Exposes `getSnapshot`/`subscribe` for `useSyncExternalStore`.
 */
export class AppRunController {
  private readonly store = new SnapshotStore<RunState>({ type: "idle" });
  private epoch = 0;
  private readonly waiters = new Map<number, () => void>();
  private queue: Promise<void> = Promise.resolve();
  private pendingBatches = 0;
  private processing = false;
  private readonly pendingEvents: RunEvent[] = [];
  private disposed = false;

  constructor(private readonly options: AppRunControllerOptions) {}

  get appId(): number {
    return this.options.appId;
  }

  getSnapshot = this.store.getSnapshot;

  subscribe = this.store.subscribe;

  /**
   * Dispatch a user operation. Allocates a fresh runId epoch. The returned
   * promise resolves when that operation's IPC call settles (success or
   * failure — errors are surfaced via the error atom, matching the old
   * hooks' never-throwing behavior), even if the operation was superseded
   * in the meantime.
   */
  dispatch(input: RunOperationInput): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const runId = ++this.epoch;
    const settled = new Promise<void>((resolve) => {
      this.waiters.set(runId, resolve);
    });
    this.process({ ...input, appId: this.options.appId, runId });
    return settled;
  }

  /** Send a producer event derived from app output. */
  send(input: RunProducerInput): void {
    if (this.disposed) {
      return;
    }
    if (input.type === "PROXY_READY") {
      this.process({
        type: "PROXY_READY",
        appId: this.options.appId,
        runId: this.epoch,
        url: input.url,
      });
      return;
    }
    this.process({ ...input, appId: this.options.appId });
  }

  /**
   * Re-entrancy guard: a listener/onStateChange callback (or a command
   * emitting a completion synchronously) may call send()/dispatch() while an
   * event is being processed. Buffering keeps event handling strictly
   * sequential so an inner event's commands can never be enqueued before the
   * outer event's commands.
   */
  private process(event: RunEvent): void {
    if (this.disposed) {
      return;
    }
    this.pendingEvents.push(event);
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        this.processOne(next);
      }
    } finally {
      this.processing = false;
    }
  }

  private processOne(event: RunEvent): void {
    if (this.disposed) {
      return;
    }
    if (RUN_ID_TAGGED_EVENTS.has(event.type) && "runId" in event) {
      // Settle the dispatch promise even for superseded operations…
      const resolve = this.waiters.get(event.runId);
      if (resolve) {
        this.waiters.delete(event.runId);
        resolve();
      }
      // …but a stale runId never advances the state.
      if (event.runId !== this.epoch) {
        this.options.observer?.onEventIgnored?.({
          state: this.store.getSnapshot(),
          event,
          reason: "stale-run-id",
        });
        return;
      }
    }

    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.options.observer, previous, event, result);
    // Enqueue commands before notifying listeners so a listener reacting to
    // the new state cannot get its own commands ahead of this event's.
    if (result.commands.length > 0) {
      this.enqueue(result.commands);
    }
    if (result.state !== previous) {
      this.store.setState(result.state, () => {
        this.options.onStateChange?.(result.state);
      });
    }
  }

  /** Permanently detaches this controller from queued and late work. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingEvents.length = 0;
    for (const resolve of this.waiters.values()) resolve();
    this.waiters.clear();
    this.store.dispose();
  }

  private enqueue(commands: readonly RunCommand[]): void {
    const emit = (event: RunEvent) => this.process(event);
    const runBatch = async () => {
      try {
        for (const command of commands) {
          if (this.disposed) break;
          await this.options.executor.execute(command, emit);
        }
      } catch (error) {
        console.error(
          `Run command execution failed for app ${this.options.appId}:`,
          error,
        );
      } finally {
        this.pendingBatches--;
      }
    };

    this.pendingBatches++;
    if (this.pendingBatches === 1) {
      // Queue idle: start immediately so purely-synchronous commands (URL
      // application, reload-token bumps) apply their effects in the same
      // tick the event was processed, like the pre-machine code did.
      this.queue = runBatch();
    } else {
      this.queue = this.queue.then(runBatch);
    }
  }
}
