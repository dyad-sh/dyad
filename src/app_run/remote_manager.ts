import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import type { RemoteMachineClientConnection } from "@/distributed_machines/remote_client";
import { IpcRemoteMachineConnection } from "@/distributed_machines/ipc_connection";
import { PreviewConsoleStore } from "@/preview_console/store";
import { DyadError } from "@/errors/dyad_error";
import {
  appRunKey,
  projectAppRunRemoteSnapshot,
  type AppRunIntentEvent,
  type AppRunRemoteSnapshot,
} from "./transport";
import { appRunClientDefinition } from "./client_definition";

export type AppRunRemoteConnection = RemoteMachineClientConnection & {
  start?: () => () => void;
};

export type AppRunRemoteStateChangedListener = (
  appId: number,
  state: AppRunRemoteSnapshot,
) => void;

type RunOperationInput =
  | { type: "START"; startedAt: number }
  | {
      type: "RESTART";
      startedAt: number;
      options: { removeNodeModules: boolean; recreateSandbox: boolean };
    }
  | { type: "REBUILD"; startedAt: number }
  | { type: "STOP"; startedAt: number };

interface SettlementResult {
  settlement: NonNullable<AppRunRemoteSnapshot["lastSettlement"]> | null;
  errorMessage?: string;
}

/**
 * Per-window adapter over main-hosted app-run actors.
 *
 * It owns only remote subscriptions and the independent console display
 * buffer. All lifecycle state and command execution live in main.
 */
export class AppRunRemoteManager {
  readonly previewConsole = new PreviewConsoleStore();
  private readonly client: RemoteMachineClient;
  private readonly actorSubscriptions = new Map<
    number,
    { consumers: number; unsubscribe: () => void }
  >();
  private readonly listeners = new Set<AppRunRemoteStateChangedListener>();
  private readonly settlementWaiters = new Map<
    string,
    { appId: number; resolve: (result: SettlementResult) => void }
  >();
  private stopConnection?: () => void;
  private disposed = false;

  constructor(
    private readonly ids: IdSource = uuidIdSource,
    private readonly connection: AppRunRemoteConnection = new IpcRemoteMachineConnection(),
  ) {
    this.client = new RemoteMachineClient(this.connection, ids);
  }

  start(): void {
    if (this.disposed || this.stopConnection) return;
    this.stopConnection = this.connection.start?.() ?? (() => undefined);
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.stopConnection?.();
    this.stopConnection = undefined;
  }

  getSnapshot = (appId: number): AppRunRemoteSnapshot =>
    this.actor(appId).getSnapshot();

  subscribeKey = (appId: number, listener: () => void): (() => void) => {
    const actor = this.actor(appId);
    const releaseManagerSubscription = this.retainActorSubscription(
      appId,
      actor,
    );
    const unsubscribe = actor.subscribe(listener);
    return () => {
      unsubscribe();
      releaseManagerSubscription();
    };
  };

  subscribeRunStateChanged = (
    listener: AppRunRemoteStateChangedListener,
  ): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async dispatch(appId: number, input: RunOperationInput): Promise<void> {
    this.start();
    const actor = this.actor(appId);
    const releaseManagerSubscription = this.retainActorSubscription(
      appId,
      actor,
    );
    try {
      await actor.resync();
      const snapshot = actor.getSnapshot();
      let event: AppRunIntentEvent;
      switch (input.type) {
        case "START":
          event = {
            type: "START",
            operationId: this.ids.next("app-run"),
            startedAt: input.startedAt,
            expectedRevision: snapshot.revision,
          };
          break;
        case "RESTART":
          event = {
            type: "RESTART",
            operation: "restart",
            operationId: this.ids.next("app-run"),
            startedAt: input.startedAt,
            expectedRevision: snapshot.revision,
            options: input.options,
          };
          break;
        case "REBUILD":
          event = {
            type: "RESTART",
            operation: "rebuild",
            operationId: this.ids.next("app-run"),
            startedAt: input.startedAt,
            expectedRevision: snapshot.revision,
          };
          break;
        case "STOP":
          if (!snapshot.invocationRef) return;
          event = {
            type: "STOP_REQUESTED",
            operationId: this.ids.next("app-run-stop"),
            startedAt: input.startedAt,
            activeInvocationRef: snapshot.invocationRef,
          };
          break;
      }
      let settlement = this.waitForSettlement(appId, event.operationId);
      let receipt: Awaited<ReturnType<typeof actor.dispatch>>;
      try {
        receipt = await actor.dispatch(event);
      } catch (error) {
        settlement.cancel();
        throw error;
      }
      if (
        input.type === "START" &&
        event.type === "START" &&
        receipt.kind === "rejected" &&
        receipt.reason === "revision-conflict"
      ) {
        settlement.cancel();
        await actor.resync();
        const latest = actor.getSnapshot();
        if (
          latest.phase === "starting" ||
          latest.phase === "ready" ||
          latest.phase === "reloading"
        ) {
          return;
        }
        event = { ...event, expectedRevision: latest.revision };
        settlement = this.waitForSettlement(appId, event.operationId);
        try {
          receipt = await actor.dispatch(event);
        } catch (error) {
          settlement.cancel();
          throw error;
        }
      }
      if (receipt.kind === "rejected") {
        settlement.cancel();
        throw new Error(`App run request rejected: ${receipt.reason}`);
      }
      if (receipt.kind === "ignored") {
        settlement.cancel();
        return;
      }
      const result = await settlement.promise;
      if (!result.settlement || result.settlement.outcome === "failed") {
        const error = result.settlement?.error;
        if (error?.kind) {
          throw new DyadError(error.message, error.kind);
        }
        throw new Error(
          error?.message ??
            result.errorMessage ??
            "App runtime operation failed",
        );
      }
    } finally {
      releaseManagerSubscription();
    }
  }

  requestManualReload = (appId: number): void => {
    this.start();
    const actor = this.actor(appId);
    const releaseManagerSubscription = this.retainActorSubscription(
      appId,
      actor,
    );
    void (async () => {
      try {
        await actor.resync();
        const receipt = await actor.dispatch({
          type: "MANUAL_RELOAD",
          operationId: this.ids.next("app-run-reload"),
          startedAt: Date.now(),
        });
        if (receipt.kind === "rejected") {
          throw new Error(`App reload request rejected: ${receipt.reason}`);
        }
      } catch (error) {
        console.error("[app-run] Preview reload dispatch failed:", error);
      } finally {
        releaseManagerSubscription();
      }
    })();
  };

  disposeKey = (appId: number): void => {
    this.actorSubscriptions.get(appId)?.unsubscribe();
    this.actorSubscriptions.delete(appId);
    this.previewConsole.disposeKey(appId);
    this.resolveSettlementsForApp(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const subscription of this.actorSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.actorSubscriptions.clear();
    this.listeners.clear();
    this.previewConsole.dispose();
    for (const waiter of this.settlementWaiters.values()) {
      waiter.resolve({
        settlement: null,
        errorMessage: "App run manager was disposed",
      });
    }
    this.settlementWaiters.clear();
    this.client.dispose();
  }

  private actor(appId: number) {
    return this.client.actor(appRunClientDefinition, appRunKey(appId));
  }

  private retainActorSubscription(
    appId: number,
    actor: ReturnType<AppRunRemoteManager["actor"]>,
  ): () => void {
    const existing = this.actorSubscriptions.get(appId);
    if (existing) {
      existing.consumers += 1;
      return this.releaseActorSubscription(appId, existing);
    }
    const subscription = {
      consumers: 1,
      unsubscribe: actor.subscribe(() =>
        this.handleActorSnapshot(appId, actor),
      ),
    };
    this.actorSubscriptions.set(appId, subscription);
    return this.releaseActorSubscription(appId, subscription);
  }

  private releaseActorSubscription(
    appId: number,
    subscription: { consumers: number; unsubscribe: () => void },
  ): () => void {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.actorSubscriptions.get(appId) !== subscription) return;
      subscription.consumers -= 1;
      if (subscription.consumers > 0) return;
      subscription.unsubscribe();
      this.actorSubscriptions.delete(appId);
    };
  }

  private handleActorSnapshot(
    appId: number,
    actor: ReturnType<AppRunRemoteManager["actor"]>,
  ): void {
    const snapshot = actor.getSnapshot();
    const settlement = snapshot.lastSettlement;
    if (settlement) {
      this.settlementWaiters.get(settlement.operationId)?.resolve({
        settlement,
      });
      this.settlementWaiters.delete(settlement.operationId);
    } else if (snapshot.revision === 0 && actor.getStatus() !== "connecting") {
      this.resolveSettlementsForApp(
        appId,
        actor.getStatus() === "ready"
          ? "App run subscription was disposed"
          : "App run subscription became unavailable",
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(appId, snapshot);
      } catch (error) {
        console.error("[app-run] Remote state listener failed:", error);
      }
    }
  }

  private waitForSettlement(appId: number, operationId: string) {
    let resolvePromise!: (result: SettlementResult) => void;
    const promise = new Promise<SettlementResult>((resolve) => {
      resolvePromise = resolve;
    });
    const waiter = { appId, resolve: resolvePromise };
    this.settlementWaiters.set(operationId, waiter);
    return {
      promise,
      cancel: () => {
        if (this.settlementWaiters.get(operationId) === waiter) {
          this.settlementWaiters.delete(operationId);
        }
      },
    };
  }

  private resolveSettlementsForApp(
    appId: number,
    errorMessage = "App run subscription was disposed",
  ): void {
    for (const [operationId, waiter] of this.settlementWaiters) {
      if (waiter.appId !== appId) continue;
      waiter.resolve({
        settlement: null,
        errorMessage,
      });
      this.settlementWaiters.delete(operationId);
    }
  }
}

export const NO_APP_RUN_REMOTE_SNAPSHOT = projectAppRunRemoteSnapshot(1, 0, {
  type: "idle",
});
