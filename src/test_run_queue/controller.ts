import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  type TransitionObserver,
} from "@/state_machines/types";
import {
  EMPTY_TEST_RUN_QUEUE,
  type TestRunQueueCommand,
  type TestRunQueueEvent,
  type TestRunQueueState,
  type TestRunRequest,
} from "./state";
import { transition } from "./transition";

export interface TestRunExecution {
  readonly runId: number;
  readonly signal: AbortSignal;
}

interface PendingRun {
  controller: AbortController;
  execute: (run: TestRunExecution) => Promise<unknown>;
  cancelled: () => unknown;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  detach: () => void;
  onQueued?: (position: number) => void;
}

/**
 * The transition owns ordering; this adapter owns cancellation and promises.
 * Commands execute only after snapshot commit. A small synchronous event FIFO
 * protects against callbacks reentering enqueue/stop during publication.
 * No other domain machine is imported; execution/broadcasts are injected.
 */
export class TestRunQueue {
  private readonly store = new SnapshotStore(EMPTY_TEST_RUN_QUEUE);
  private readonly runs = new Map<number, PendingRun>();
  private readonly events: TestRunQueueEvent[] = [];
  private dispatching = false;

  constructor(
    private readonly deps: {
      onChange: (state: TestRunQueueState) => void;
      onError: (error: unknown) => void;
      observer?: TransitionObserver<
        TestRunQueueState,
        TestRunQueueEvent,
        TestRunQueueCommand
      >;
    },
  ) {}

  getSnapshot = this.store.getSnapshot;

  ownsExecution(run: TestRunExecution): boolean {
    return (
      this.getSnapshot().activeRun?.runId === run.runId &&
      this.runs.get(run.runId)?.controller.signal === run.signal
    );
  }

  enqueue<Result>(options: {
    request: TestRunRequest;
    signal?: AbortSignal;
    execute: (run: TestRunExecution) => Promise<Result>;
    cancelled: () => Result;
    onQueued?: (position: number) => void;
  }): Promise<Result> {
    const { request, signal } = options;
    if (signal?.aborted) return Promise.resolve(options.cancelled());
    if (this.runs.has(request.runId))
      return Promise.reject(new Error("Duplicate test run identity"));
    return new Promise<Result>((resolve, reject) => {
      const onAbort = () => this.send({ type: "cancel", runId: request.runId });
      this.runs.set(request.runId, {
        controller: new AbortController(),
        execute: options.execute,
        cancelled: options.cancelled,
        resolve: (value) => resolve(value as Result),
        reject,
        detach: () => signal?.removeEventListener("abort", onAbort),
        onQueued: options.onQueued,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.send({ type: "enqueue", request });
    });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  async drain(): Promise<void> {
    if (!this.getSnapshot().activeRun) return;
    await new Promise<void>((resolve) => {
      const unsubscribe = this.store.subscribe(() => {
        if (this.getSnapshot().activeRun) return;
        unsubscribe();
        resolve();
      });
    });
  }

  private send(event: TestRunQueueEvent): void {
    this.events.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.events.length > 0) {
        const next = this.events.shift()!;
        const previous = this.store.getSnapshot();
        const result = transition(previous, next);
        if (result.kind === "applied") this.store.setState(result.state);
        try {
          observeTransition(this.deps.observer, previous, next, result);
          if (result.kind === "applied") this.deps.onChange(result.state);
        } catch (error) {
          this.deps.onError(error);
        }
        if (result.kind === "applied") {
          for (const [index, run] of result.state.queuedRuns.entries()) {
            try {
              this.runs.get(run.runId)?.onQueued?.(index + 1);
            } catch (error) {
              this.deps.onError(error);
            }
          }
          for (const command of result.commands) this.runCommand(command);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  private runCommand(command: TestRunQueueCommand): void {
    const pending = this.runs.get(command.runId);
    if (!pending) return;
    switch (command.type) {
      case "execute":
        // Defer execution so reentrant cancellation published during admission
        // is committed before a callback can acquire resources.
        void Promise.resolve().then(async () => {
          try {
            const result = pending.controller.signal.aborted
              ? pending.cancelled()
              : await pending.execute({
                  runId: command.runId,
                  signal: pending.controller.signal,
                });
            pending.resolve(result);
          } catch (error) {
            pending.reject(error);
          } finally {
            pending.detach();
            this.runs.delete(command.runId);
            this.send({ type: "settled", runId: command.runId });
          }
        });
        break;
      case "abort":
        pending.controller.abort();
        break;
      case "cancel-queued":
        pending.detach();
        this.runs.delete(command.runId);
        try {
          pending.resolve(pending.cancelled());
        } catch (error) {
          pending.reject(error);
        }
        break;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }
}
