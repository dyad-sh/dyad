import { setPreviewRunStateForAppAtom } from "@/atoms/previewRuntimeAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { InvocationRegistry } from "@/state_machines/invocation_ref";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { createTraceObserver } from "@/state_machines/trace";
import {
  registerAtomWriter,
  type AtomProjectionWriter,
} from "@/state_machines/projection";
import { createIpcRunCommandExecutor, type JotaiStore } from "./commands";
import {
  AppRunController,
  type ExternalRunOperationInput,
  type RunOperationInput,
  type RunProducerInput,
} from "./controller";
import { selectAppExit, type AppExit } from "./selectors";
import type { AppRunInvocationRef, RunState } from "./state";
import type { RunCommand, RunEvent } from "./state";
import type { TransitionObserver } from "@/state_machines/types";
import { projectRunState } from "./transition";

const IDLE_STATE: RunState = { type: "idle" };

/** Provider-owned facade for the app-keyed run-state controllers. */
export class AppRunManager {
  private readonly host: KeyedControllerHost<number, AppRunController>;
  private readonly invocations = new InvocationRegistry<AppRunController>();
  private readonly activeRefs = new Map<number, AppRunInvocationRef>();
  private readonly admittedExitStores = new Map<
    number,
    SnapshotStore<AppExit | null>
  >();
  private projectionWriter: AtomProjectionWriter<unknown> | null = null;
  private projectionEnabled = true;

  constructor(
    private readonly store: JotaiStore,
    observer?: TransitionObserver<RunState, RunEvent, RunCommand>,
    private readonly idSource: IdSource = uuidIdSource,
  ) {
    this.host = new KeyedControllerHost((appId) => {
      let controller: AppRunController;
      controller = new AppRunController({
        appId,
        idSource: this.idSource,
        executor: createIpcRunCommandExecutor(store),
        onInvocationStarted: (ref) => {
          this.invocations.register(ref, controller);
          this.activeRefs.set(appId, ref);
        },
        onStateChange: (state) => {
          // The machine is the sole writer of the legacy run-state
          // projection consumed by preview runtime atoms.
          this.writeProjection({
            appId,
            state: projectRunState(state),
          });
        },
        observer: observer ?? createTraceObserver("app_run", appId),
      });
      return controller;
    });
  }

  start(): void {
    this.projectionEnabled = true;
    this.ensureProjectionWriter();
  }

  stop(): void {
    this.projectionEnabled = false;
    this.projectionWriter?.dispose();
    this.projectionWriter = null;
  }

  getSnapshot = (appId: number): RunState =>
    this.host.get(appId)?.getSnapshot() ?? IDLE_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  /**
   * APP_EXIT read model. `RunState.stopped` is authoritative when the
   * transition applies; the manager-owned fallback preserves admitted
   * legacy/fast-start exits that the unchanged transition table ignores.
   */
  getAppExitSnapshot = (appId: number): AppExit | null =>
    this.admittedExitStores.get(appId)?.getSnapshot() ??
    selectAppExit(this.getSnapshot(appId));

  subscribeAppExit = (appId: number, listener: () => void): (() => void) => {
    const unsubscribeState = this.subscribeKey(appId, listener);
    const unsubscribeFallback =
      this.ensureAdmittedExitStore(appId).subscribe(listener);
    return () => {
      unsubscribeState();
      unsubscribeFallback();
    };
  };

  dispatch(appId: number, input: RunOperationInput): Promise<void> {
    const pending = this.host.ensure(appId).dispatch(input);
    if (input.type !== "STOP") this.clearAdmittedExit(appId);
    return pending;
  }

  /**
   * Routes producer work and reports whether its identity was admitted.
   * Legacy ref-less events retain key-only routing for app-update
   * compatibility.
   */
  send(appId: number, input: RunProducerInput): boolean {
    if ("invocationRef" in input && input.invocationRef) {
      if (input.invocationRef.entityKey !== appId) {
        // Keep the routing key and InvocationRef entity key distinct: a
        // malformed producer event must never claim another app's controller.
        this.host.get(appId)?.send(input);
        return false;
      }
      const claim = this.invocations.claim(input.invocationRef);
      if (claim.kind === "claimed") {
        claim.value.send(input);
        if (input.type === "APP_EXIT") {
          this.recordUnrepresentedExit(appId, input, claim.value);
        }
        return true;
      } else {
        // Preserve ignored-event tracing without admitting stale work.
        this.host.get(appId)?.send(input);
        return false;
      }
    }
    const controller = this.host.ensure(appId);
    controller.send(input);
    if (input.type === "APP_EXIT") {
      this.recordUnrepresentedExit(appId, input, controller);
    }
    return true;
  }

  beginExternal(appId: number, input: ExternalRunOperationInput): void {
    this.host.ensure(appId).beginExternal(input);
    this.clearAdmittedExit(appId);
  }

  settleExternal(
    appId: number,
    requestId: string,
    invocationRef?: import("./state").AppRunInvocationRef,
    error?: { message: string },
  ): void {
    this.host.get(appId)?.settleExternal(requestId, invocationRef, error);
  }

  disposeKey = (appId: number): void => {
    const ref = this.activeRefs.get(appId);
    if (ref) {
      this.invocations.delete(ref);
      this.activeRefs.delete(appId);
    }
    this.clearAdmittedExit(appId);
    this.host.disposeKey(appId);
    this.admittedExitStores.get(appId)?.dispose();
    this.admittedExitStores.delete(appId);
  };

  dispose(): void {
    this.stop();
    for (const ref of this.activeRefs.values()) {
      this.invocations.delete(ref);
    }
    this.activeRefs.clear();
    this.host.dispose();
    for (const store of this.admittedExitStores.values()) store.dispose();
    this.admittedExitStores.clear();
  }

  private ensureAdmittedExitStore(
    appId: number,
  ): SnapshotStore<AppExit | null> {
    let store = this.admittedExitStores.get(appId);
    if (!store) {
      store = new SnapshotStore<AppExit | null>(null);
      this.admittedExitStores.set(appId, store);
    }
    return store;
  }

  private clearAdmittedExit(appId: number): void {
    this.admittedExitStores.get(appId)?.setState(null);
  }

  private recordUnrepresentedExit(
    appId: number,
    input: Extract<RunProducerInput, { type: "APP_EXIT" }>,
    controller: AppRunController,
  ): void {
    const stateExit = selectAppExit(controller.getSnapshot());
    if (
      stateExit?.exitCode === input.exitCode &&
      stateExit.timestamp === input.timestamp
    ) {
      this.clearAdmittedExit(appId);
      return;
    }
    this.ensureAdmittedExitStore(appId).setState({
      appId,
      exitCode: input.exitCode,
      timestamp: input.timestamp,
    });
  }

  private writeProjection(value: unknown): void {
    if (!this.projectionEnabled) return;
    this.ensureProjectionWriter().write(value);
  }

  private ensureProjectionWriter(): AtomProjectionWriter<unknown> {
    this.projectionWriter ??= registerAtomWriter(
      this.store,
      setPreviewRunStateForAppAtom,
    );
    return this.projectionWriter;
  }
}
