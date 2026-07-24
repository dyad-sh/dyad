import type { RunCommandExecutor } from "./commands";
import type {
  AppRunIgnoreReason,
  AppRunInvocationRef,
  RestartOptions,
  RunCommand,
  RunEvent,
  RunState,
  RunUrl,
} from "./state";
import { APP_RUN_INVOCATION_KIND } from "./state";
import { transition } from "./transition";
import type { IdSource } from "@/state_machines/clock";
import {
  createInvocationRef,
  invocationRegistryKey,
  sameInvocationRef,
} from "@/state_machines/invocation_ref";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import {
  observeTransition,
  STALE_OPERATION_IGNORE_REASON,
  type TransitionObserver,
} from "@/state_machines/types";

/** User operations; the controller mints their refs at this start boundary. */
export type RunOperationInput =
  | { type: "START"; startedAt: number }
  | { type: "RESTART"; startedAt: number; options: RestartOptions }
  | { type: "REBUILD"; startedAt: number }
  | { type: "STOP"; startedAt: number };

/**
 * Process-produced events. New main processes echo the producer's ref;
 * absent refs preserve legacy key-only routing to the current invocation.
 */
export type RunProducerInput =
  | {
      type: "PROXY_READY";
      invocationRef?: AppRunInvocationRef;
      url: RunUrl;
    }
  | { type: "HMR_DETECTED" }
  | { type: "MANUAL_RELOAD" }
  | {
      type: "APP_EXIT";
      invocationRef?: AppRunInvocationRef;
      exitCode: number | null;
      timestamp: number;
    };

export type ExternalRunOperationInput = {
  requestId: string;
  operation: "restart" | "rebuild";
  startedAt: number;
  /** Present when the authoritative main-process caller supports refs. */
  invocationRef?: AppRunInvocationRef;
};

const SETTLING_EVENTS = new Set<RunEvent["type"]>([
  "RUN_IPC_RESOLVED",
  "RUN_IPC_FAILED",
  "STOP_IPC_RESOLVED",
  "STOP_IPC_FAILED",
]);

const REF_TAGGED_EVENTS = new Set<RunEvent["type"]>([
  ...SETTLING_EVENTS,
  "RELOAD_DONE",
  "PROXY_READY",
  "APP_EXIT",
]);

export interface AppRunControllerOptions {
  appId: number;
  idSource: IdSource;
  executor: RunCommandExecutor;
  /** Called after every state change (e.g. to publish atom projections). */
  onStateChange?: (state: RunState) => void;
  /** Registers each freshly authoritative invocation with the owning manager. */
  onInvocationStarted?: (ref: AppRunInvocationRef) => void;
  observer?: TransitionObserver<
    RunState,
    RunEvent,
    RunCommand,
    AppRunIgnoreReason
  >;
}

/**
 * Per-app run-state controller.
 *
 * - Mints a globally unique InvocationRef for each operation. Tagged
 *   completions and process events can only claim the current ref.
 * - Executes commands serially per app. Commands report IPC settlement as
 *   events instead of blocking the queue, so a superseding operation is
 *   never stuck behind its predecessor's in-flight spawn.
 * - Retains the existing re-entrancy FIFO and processing semantics.
 */
export class AppRunController {
  private readonly store = new SnapshotStore<RunState>({ type: "idle" });
  private activeRef: AppRunInvocationRef | undefined;
  private readonly waiters = new Map<string, () => void>();
  private readonly externalRefs = new Map<string, AppRunInvocationRef>();
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

  dispatch(input: RunOperationInput): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const invocationRef = this.mintRef();
    this.activeRef = invocationRef;
    this.options.onInvocationStarted?.(invocationRef);
    const settled = new Promise<void>((resolve) => {
      this.waiters.set(invocationRegistryKey(invocationRef), resolve);
    });
    this.process({ ...input, appId: this.options.appId, invocationRef });
    return settled;
  }

  /** Send an event derived from app output. */
  send(input: RunProducerInput): void {
    if (this.disposed) {
      return;
    }
    if (input.type === "PROXY_READY" || input.type === "APP_EXIT") {
      let invocationRef = input.invocationRef ?? this.activeRef;
      if (
        !invocationRef &&
        !input.invocationRef &&
        input.type === "PROXY_READY"
      ) {
        // App-update compatibility: an older main process cannot echo refs.
        // With no active controller operation, preserve the old key-only
        // cached-URL routing by adopting a renderer-local legacy invocation.
        invocationRef = this.mintRef();
        this.activeRef = invocationRef;
        this.options.onInvocationStarted?.(invocationRef);
      }
      if (!invocationRef || invocationRef.entityKey !== this.options.appId) {
        this.ignoreProducer(input);
        return;
      }
      this.process({
        ...input,
        appId: this.options.appId,
        invocationRef,
      });
      return;
    }
    this.process({ ...input, appId: this.options.appId });
  }

  beginExternal(input: ExternalRunOperationInput): void {
    if (this.disposed) {
      return;
    }
    if (
      input.invocationRef &&
      input.invocationRef.entityKey !== this.options.appId
    ) {
      return;
    }
    const invocationRef = input.invocationRef ?? this.mintRef();
    this.activeRef = invocationRef;
    this.options.onInvocationStarted?.(invocationRef);
    this.externalRefs.set(input.requestId, invocationRef);
    this.process({
      type: "EXTERNAL_RESTART",
      appId: this.options.appId,
      invocationRef,
      operation: input.operation,
      startedAt: input.startedAt,
    });
  }

  settleExternal(
    requestId: string,
    invocationRef?: AppRunInvocationRef,
    error?: { message: string },
  ): void {
    if (this.disposed) {
      return;
    }
    const expectedRef = this.externalRefs.get(requestId);
    if (
      !expectedRef ||
      (invocationRef && !sameInvocationRef(expectedRef, invocationRef))
    ) {
      return;
    }
    this.externalRefs.delete(requestId);
    this.process(
      error
        ? { type: "RUN_IPC_FAILED", invocationRef: expectedRef, error }
        : { type: "RUN_IPC_RESOLVED", invocationRef: expectedRef },
    );
  }

  /**
   * Re-entrancy guard: a listener/onStateChange callback (or a command
   * emitting a completion synchronously) may call send()/dispatch() while an
   * event is being processed. Buffering keeps event handling strictly
   * sequential so an inner event's commands can never precede the outer
   * event's commands.
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
    if (REF_TAGGED_EVENTS.has(event.type) && "invocationRef" in event) {
      if (SETTLING_EVENTS.has(event.type)) {
        const key = invocationRegistryKey(event.invocationRef);
        const resolve = this.waiters.get(key);
        if (resolve) {
          this.waiters.delete(key);
          resolve();
        }
      }
      if (
        !this.activeRef ||
        !sameInvocationRef(event.invocationRef, this.activeRef)
      ) {
        this.options.observer?.onEventIgnored?.({
          state: this.store.getSnapshot(),
          event,
          reason: STALE_OPERATION_IGNORE_REASON,
        });
        return;
      }
    }

    const previous = this.store.getSnapshot();
    const result = transition(previous, event);
    observeTransition(this.options.observer, previous, event, result);
    if (result.kind === "ignored") return;
    // Enqueue before notifying so re-entrant work cannot overtake this batch.
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
    this.activeRef = undefined;
    this.pendingEvents.length = 0;
    for (const resolve of this.waiters.values()) resolve();
    this.waiters.clear();
    this.externalRefs.clear();
    this.store.dispose();
  }

  private mintRef(): AppRunInvocationRef {
    return createInvocationRef(
      APP_RUN_INVOCATION_KIND,
      this.options.appId,
      this.options.idSource,
    );
  }

  private ignoreProducer(input: RunProducerInput): void {
    const invocationRef =
      "invocationRef" in input ? input.invocationRef : undefined;
    if (!invocationRef) return;
    const event = {
      ...input,
      appId: this.options.appId,
      invocationRef,
    } as RunEvent;
    this.options.observer?.onEventIgnored?.({
      state: this.store.getSnapshot(),
      event,
      reason: STALE_OPERATION_IGNORE_REASON,
    });
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
      this.queue = runBatch();
    } else {
      this.queue = this.queue.then(runBatch);
    }
  }
}
