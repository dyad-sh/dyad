import log from "electron-log";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { createInvocationRef } from "@/state_machines/invocation_ref";
import {
  uuidIdSource,
  systemClock,
  type Clock,
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

export type RunDeployPipeline = typeof runDeployPipeline;

export interface CoolifyDeployRegistryDeps {
  clock: Clock;
  ids: IdSource;
  runPipeline: RunDeployPipeline;
}

/**
 * Main-process registry hosting one deployment machine per app.
 *
 * Commands are data returned by the pure transition and executed here. A
 * running pipeline owns an AbortController keyed by its operation id, so
 * disconnecting cancels the work rather than letting it finish and write its
 * result over state the user has already cleared.
 *
 * Constructed rather than module-global so tests own an isolated instance with
 * a fake clock and sequential ids instead of resetting shared state.
 */
export class CoolifyDeployRegistry {
  private readonly stores = new Map<
    number,
    SnapshotStore<CoolifyDeployState>
  >();
  private readonly aborts = new Map<string, AbortController>();
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
    return this.stores.get(appId)?.getSnapshot() ?? IDLE;
  }

  /**
   * Whether this app still holds a machine.
   *
   * An idle app and a forgotten one both read as idle through `getSnapshot`,
   * so disposal is only observable through this.
   */
  hasMachine(appId: number): boolean {
    return this.stores.has(appId);
  }

  onSnapshot(
    listener: (appId: number, state: CoolifyDeployState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestDeploy(appId: number): void {
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
    for (const appId of [...this.stores.keys()]) this.cancelDeploy(appId);
  }

  /**
   * Abandons and forgets one app's machine.
   *
   * Call when the app is deleted: without this its store and any running
   * pipeline outlive the entity they belong to.
   */
  dispose(appId: number): void {
    const store = this.stores.get(appId);
    const state = store?.getSnapshot();
    if (state?.type === "running") {
      this.aborts.get(state.invocationRef.operationId)?.abort();
      this.aborts.delete(state.invocationRef.operationId);
    }
    store?.dispose();
    this.stores.delete(appId);
  }

  /** Call when every app is going away, as a reset does. */
  disposeAll(): void {
    for (const appId of [...this.stores.keys()]) this.dispose(appId);
    for (const controller of this.aborts.values()) controller.abort();
    this.aborts.clear();
  }

  private dispatch(appId: number, event: CoolifyDeployEvent): void {
    const existing = this.stores.get(appId);
    const result = transition(existing?.getSnapshot() ?? IDLE, event);
    if (result.kind === "ignored") {
      logger.debug(
        `Ignored ${event.type} for app ${appId}: ${String(result.reason)}`,
      );
      return;
    }
    // Only materialise a store once an event actually produces state, so a
    // late callback arriving after dispose cannot resurrect a deleted app.
    let store = existing;
    if (!store) {
      store = new SnapshotStore<CoolifyDeployState>(IDLE);
      this.stores.set(appId, store);
    }
    store.setState(result.state);
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
      case "RUN_DEPLOY":
        void this.startPipeline(
          appId,
          command.invocationRef,
          command.resumeDeploymentUuid,
        );
        return;
      case "ABORT_DEPLOY": {
        this.aborts.get(command.invocationRef.operationId)?.abort();
        this.aborts.delete(command.invocationRef.operationId);
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
  ): Promise<void> {
    const controller = new AbortController();
    this.aborts.set(invocationRef.operationId, controller);
    try {
      const { url } = await this.deps.runPipeline({
        appId,
        resumeDeploymentUuid,
        signal: controller.signal,
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
    } finally {
      this.aborts.delete(invocationRef.operationId);
    }
  }
}

export const coolifyDeployRegistry = new CoolifyDeployRegistry();
