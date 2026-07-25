import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { InvocationRegistry } from "@/state_machines/invocation_ref";
import { createTraceObserver } from "@/state_machines/trace";
import { createIpcRunCommandExecutor, type JotaiStore } from "./commands";
import {
  AppRunController,
  type ExternalRunOperationInput,
  type RunOperationInput,
  type RunProducerInput,
} from "./controller";
import type { AppRunInvocationRef, RunState } from "./state";
import type { RunCommand, RunEvent } from "./state";
import type { TransitionObserver } from "@/state_machines/types";

const IDLE_STATE: RunState = { type: "idle" };
export type RunStateChangedListener = (appId: number, state: RunState) => void;

/**
 * Provider-owned facade for the app-keyed run-state controllers.
 *
 * Machine dependency graph: app_run -> preview_iframe through the injected
 * AppRunStateSubscriptionFacade assembled outside both machine directories.
 */
export class AppRunManager {
  private readonly host: KeyedControllerHost<number, AppRunController>;
  private readonly invocations = new InvocationRegistry<AppRunController>();
  private readonly activeRefs = new Map<number, AppRunInvocationRef>();
  private readonly runStateListeners = new Set<RunStateChangedListener>();
  private readonly reloadTokens = new Map<number, number>();
  private readonly reloadTokenListeners = new Map<number, Set<() => void>>();
  private disposed = false;

  constructor(
    store: JotaiStore,
    observer?: TransitionObserver<RunState, RunEvent, RunCommand>,
    private readonly idSource: IdSource = uuidIdSource,
  ) {
    this.host = new KeyedControllerHost((appId) => {
      let controller: AppRunController;
      controller = new AppRunController({
        appId,
        idSource: this.idSource,
        executor: createIpcRunCommandExecutor(store, {
          onReloadTokenBumped: (bumpedAppId) => {
            // Commands begin executing before AppRunController publishes the
            // transition snapshot. Defer the token edge so URL/run state is
            // committed before reload consumers observe the new counter.
            queueMicrotask(() => {
              if (!this.disposed && this.host.get(appId) === controller) {
                this.bumpReloadToken(bumpedAppId);
              }
            });
          },
        }),
        onInvocationStarted: (ref) => {
          this.invocations.register(ref, controller);
          this.activeRefs.set(appId, ref);
        },
        onStateChange: (state) => {
          // AppRunController invokes this during its committed snapshot
          // notification. The preview_iframe controller has no re-entrancy
          // buffer, so every cross-machine callback crosses a microtask.
          queueMicrotask(() => {
            if (this.disposed || this.host.get(appId) !== controller) return;
            for (const listener of this.runStateListeners) {
              try {
                listener(appId, state);
              } catch (error) {
                console.error("[app-run] Run-state listener failed:", error);
              }
            }
          });
        },
        observer: observer ?? createTraceObserver("app_run", appId),
      });
      return controller;
    });
  }

  start(): void {
    // The manager has no external subscription to acquire.
  }

  stop(): void {
    // Final resources are released by dispose().
  }

  getSnapshot = (appId: number): RunState =>
    this.host.get(appId)?.getSnapshot() ?? IDLE_STATE;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  /**
   * Remote intent: read/subscription.
   *
   * Notifications are post-commit and microtask-deferred. RunState carries
   * the authoritative invocation ref used to correlate lifecycle edges.
   */
  subscribeRunStateChanged = (
    listener: RunStateChangedListener,
  ): (() => void) => {
    if (this.disposed) return () => undefined;
    this.runStateListeners.add(listener);
    return () => this.runStateListeners.delete(listener);
  };

  getReloadToken = (appId: number): number => this.reloadTokens.get(appId) ?? 0;

  subscribeReloadToken = (
    appId: number,
    listener: () => void,
  ): (() => void) => {
    if (this.disposed) return () => undefined;
    let listeners = this.reloadTokenListeners.get(appId);
    if (!listeners) {
      listeners = new Set();
      this.reloadTokenListeners.set(appId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.reloadTokenListeners.delete(appId);
    };
  };

  dispatch(appId: number, input: RunOperationInput): Promise<void> {
    return this.host.ensure(appId).dispatch(input);
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
        return true;
      } else {
        // Preserve ignored-event tracing without admitting stale work.
        this.host.get(appId)?.send(input);
        return false;
      }
    }
    this.host.ensure(appId).send(input);
    return true;
  }

  /**
   * Remote intent: idempotent/current-agnostic.
   *
   * This deliberately reuses MANUAL_RELOAD instead of introducing a token-only
   * event: callers request the same preview reload as the existing manual UI.
   * In ready state that includes the intentional transient `reloading` state.
   */
  requestManualReload = (appId: number): void => {
    this.send(appId, { type: "MANUAL_RELOAD" });
  };

  beginExternal(appId: number, input: ExternalRunOperationInput): void {
    this.host.ensure(appId).beginExternal(input);
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
    if (this.reloadTokens.delete(appId)) {
      this.notifyReloadToken(appId);
    }
    this.host.disposeKey(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const ref of this.activeRefs.values()) {
      this.invocations.delete(ref);
    }
    this.activeRefs.clear();
    this.reloadTokens.clear();
    this.runStateListeners.clear();
    this.reloadTokenListeners.clear();
    this.host.dispose();
  }

  private bumpReloadToken(appId: number): void {
    this.reloadTokens.set(appId, this.getReloadToken(appId) + 1);
    this.notifyReloadToken(appId);
  }

  private notifyReloadToken(appId: number): void {
    for (const listener of this.reloadTokenListeners.get(appId) ?? []) {
      try {
        listener();
      } catch (error) {
        console.error("[app-run] Reload-token listener failed:", error);
      }
    }
  }
}
