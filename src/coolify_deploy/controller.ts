import log from "electron-log";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { createInvocationRef } from "@/state_machines/invocation_ref";
import {
  uuidIdSource,
  systemClock,
  type Clock,
  type ClockHandle,
  type IdSource,
} from "@/state_machines/clock";
import { transition } from "./transition";
import { runDeployPipeline } from "./commands";
import {
  COOLIFY_DEPLOY_INVOCATION_KIND,
  type CoolifyDeployCommand,
  type CoolifyDeployEvent,
  type CoolifyDeployInvocationRef,
  type CoolifyDeployState,
} from "./state";

const logger = log.scope("coolify_deploy_controller");

const IDLE: CoolifyDeployState = { type: "idle" };

/**
 * How long disposal waits for an aborted pipeline to unwind.
 *
 * Every remote call carries the abort signal, so unwinding is normally
 * immediate. The bound exists so a pipeline stuck somewhere that cannot be
 * aborted still cannot block deleting an app or resetting the whole app.
 */
export const DRAIN_TIMEOUT_MS = 5_000;

export type RunDeployPipeline = typeof runDeployPipeline;

export interface CoolifyDeployRegistryDeps {
  clock: Clock;
  ids: IdSource;
  runPipeline: RunDeployPipeline;
}

/**
 * Resolves when the work settles, or when the bound elapses.
 *
 * On the injected clock, not setTimeout: rules/state-machines.md requires it,
 * and a real timer here means the bound cannot be driven by createFakeClock —
 * a test covering it would have to wait out the wall-clock seconds.
 */
async function drain(clock: Clock, work: Promise<void>): Promise<void> {
  let handle: ClockHandle | undefined;
  try {
    await Promise.race([
      work.catch(() => undefined),
      new Promise<void>((resolve) => {
        handle = clock.schedule(resolve, DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (handle !== undefined) clock.cancel(handle);
  }
}

/**
 * Everything the registry knows about one app.
 *
 * Held together rather than in parallel collections. Every disposal bug this
 * machine has had came from two collections disagreeing about whether a
 * pipeline existed, so a pipeline lives inside the machine it belongs to and
 * disposal has one place to look. Usually there is one; a cancelled pipeline
 * still unwinding sits beside the retry that replaced it until it settles.
 */
interface AppMachine {
  store: SnapshotStore<CoolifyDeployState>;
  /**
   * Every pipeline for this app that has not settled yet.
   *
   * Usually one. Cancelling moves the machine to idle while the work is still
   * unwinding, and a retry is accepted from idle, so a cancelled pipeline can
   * legitimately outlive the deploy that replaced it — and disposal has to
   * wait for both before its app's rows and files are removed.
   */
  pipelines: Map<string, { abort: AbortController; done: Promise<void> }>;
}

/**
 * Main-process registry hosting one deployment machine per app.
 *
 * Commands are data returned by the pure transition and executed here. A
 * running pipeline owns an AbortController, so disconnecting cancels the work
 * rather than letting it finish and write its result over state the user has
 * already cleared.
 *
 * Constructed rather than module-global so tests own an isolated instance with
 * a fake clock and sequential ids instead of resetting shared state.
 */
export class CoolifyDeployRegistry {
  private readonly machines = new Map<number, AppMachine>();
  /**
   * Apps mid-deletion: a deploy admitted now would outlive the app row.
   *
   * Separate because it brackets the app's deletion rather than a machine, and
   * has to outlive the machine that disposal removes.
   */
  private readonly deleting = new Set<number>();
  private readonly listeners = new Set<
    (appId: number, state: CoolifyDeployState) => void
  >();
  private readonly deps: CoolifyDeployRegistryDeps;

  constructor(deps: Partial<CoolifyDeployRegistryDeps> = {}) {
    this.deps = {
      clock: deps.clock ?? systemClock,
      ids: deps.ids ?? uuidIdSource,
      runPipeline: deps.runPipeline ?? runDeployPipeline,
    };
  }

  getSnapshot(appId: number): CoolifyDeployState {
    return this.machines.get(appId)?.store.getSnapshot() ?? IDLE;
  }

  /**
   * Whether this app still holds a machine.
   *
   * An idle app and a forgotten one both read as idle through `getSnapshot`,
   * so disposal is only observable through this.
   */
  hasMachine(appId: number): boolean {
    return this.machines.has(appId);
  }

  onSnapshot(
    listener: (appId: number, state: CoolifyDeployState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestDeploy(appId: number): void {
    if (this.deleting.has(appId)) {
      logger.debug(`Ignored deploy for app ${appId}: deletion in progress`);
      return;
    }
    this.dispatch(appId, {
      type: "DEPLOY_REQUESTED",
      appId,
      invocationRef: createInvocationRef(
        COOLIFY_DEPLOY_INVOCATION_KIND,
        appId,
        this.deps.ids,
      ),
      startedAt: this.deps.clock.now(),
    });
  }

  /** Disconnecting abandons anything running and clears a finished result. */
  cancelDeploy(appId: number): void {
    this.dispatch(appId, {
      type: "CANCELLED",
      appId,
      finishedAt: this.deps.clock.now(),
    });
  }

  /** Abandons every running deployment; the apps themselves survive. */
  cancelAll(): void {
    for (const appId of [...this.machines.keys()]) this.cancelDeploy(appId);
  }

  /**
   * Refuses new deployments for an app until endAppDeletion.
   *
   * Disposal alone is not enough: deletion continues after it returns, and a
   * deploy admitted in that window would keep talking to Coolify about an app
   * whose row and files are being removed.
   */
  beginAppDeletion(appId: number): void {
    this.deleting.add(appId);
  }

  endAppDeletion(appId: number): void {
    this.deleting.delete(appId);
  }

  /**
   * Abandons and forgets one app's machine.
   *
   * Call when the app is deleted: without this its store and any running
   * pipeline outlive the entity they belong to.
   */
  async dispose(appId: number): Promise<void> {
    const machine = this.machines.get(appId);
    // Removed first, so a late report cannot find it and a new deploy started
    // while this drains gets a machine of its own.
    this.machines.delete(appId);
    if (!machine) return;
    machine.store.dispose();
    // Every pipeline still attributed to this app, not only the newest: a
    // cancelled one lingers beside the retry that replaced it, and looking at
    // the machine state would find neither, since cancelling left it idle.
    const pending = [...machine.pipelines.values()];
    if (pending.length === 0) return;
    for (const { abort } of pending) abort.abort();
    // Aborting only makes them throw at their next checkpoint, so wait for
    // them to unwind before the caller deletes rows or closes the database.
    // One bound covers them all rather than one bound each.
    await drain(
      this.deps.clock,
      Promise.all(pending.map((p) => p.done)).then(() => undefined),
    );
  }

  /** Call when every app is going away, as a reset does. */
  async disposeAll(): Promise<void> {
    // dispose aborts before its first await, so mapping over every app aborts
    // them all before any of them starts waiting — they unwind together
    // rather than one after another, with no separate pass needed.
    //
    // Nor a second sweep afterwards: a pipeline is only reachable through its
    // machine, so nothing survives that dispose did not already wait for.
    await Promise.allSettled(
      [...this.machines.keys()].map((id) => this.dispose(id)),
    );
  }

  private dispatch(appId: number, event: CoolifyDeployEvent): void {
    const existing = this.machines.get(appId);
    const result = transition(existing?.store.getSnapshot() ?? IDLE, event);
    if (result.kind === "ignored") {
      logger.debug(
        `Ignored ${event.type} for app ${appId}: ${String(result.reason)}`,
      );
      return;
    }
    // Only materialise a machine once an event actually produces state, so a
    // late callback arriving after dispose cannot resurrect a deleted app.
    let machine = existing;
    if (!machine) {
      machine = {
        store: new SnapshotStore<CoolifyDeployState>(IDLE),
        pipelines: new Map(),
      };
      this.machines.set(appId, machine);
    }
    machine.store.setState(result.state);
    for (const listener of this.listeners) {
      try {
        listener(appId, result.state);
      } catch (error) {
        logger.error("Deploy snapshot listener failed:", error);
      }
    }
    for (const command of result.commands) {
      this.execute(appId, command);
    }
  }

  private execute(appId: number, command: CoolifyDeployCommand): void {
    switch (command.type) {
      case "RUN_DEPLOY": {
        const machine = this.machines.get(appId);
        // The dispatch that produced this command created it.
        if (!machine) return;
        const { operationId } = command.invocationRef;
        const abort = new AbortController();
        const done = this.startPipeline(
          appId,
          command.invocationRef,
          command.resumeDeploymentUuid,
          abort.signal,
        );
        machine.pipelines.set(operationId, { abort, done });
        // Deleting by key is identity-safe on its own: a retry has its own
        // operation id, and a machine disposed and rebuilt has a fresh map.
        void done.finally(() =>
          this.machines.get(appId)?.pipelines.delete(operationId),
        );
        return;
      }
      case "ABORT_DEPLOY": {
        // Left in place rather than removed: aborting only asks the pipeline
        // to stop, and disposal still has to be able to wait for it.
        this.machines
          .get(appId)
          ?.pipelines.get(command.invocationRef.operationId)
          ?.abort.abort();
        return;
      }
      default: {
        const exhaustive: never = command;
        logger.error(`Unhandled deploy command: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private async startPipeline(
    appId: number,
    invocationRef: CoolifyDeployInvocationRef,
    resumeDeploymentUuid: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const { url } = await this.deps.runPipeline({
        appId,
        resumeDeploymentUuid,
        signal,
        clock: this.deps.clock,
        report: {
          stage: (stage) =>
            this.dispatch(appId, {
              type: "STAGE_CHANGED",
              invocationRef,
              stage,
            }),
          log: (chunk) =>
            this.dispatch(appId, {
              type: "LOG_APPENDED",
              invocationRef,
              chunk,
            }),
          deploymentStarted: (deploymentUuid) =>
            this.dispatch(appId, {
              type: "DEPLOYMENT_STARTED",
              invocationRef,
              deploymentUuid,
            }),
        },
      });
      this.dispatch(appId, {
        type: "SUCCEEDED",
        invocationRef,
        url,
        finishedAt: this.deps.clock.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Coolify deploy failed for app ${appId}: ${message}`);
      this.dispatch(appId, {
        type: "FAILED",
        invocationRef,
        error: message,
        finishedAt: this.deps.clock.now(),
      });
    }
  }
}

export const coolifyDeployRegistry = new CoolifyDeployRegistry();
