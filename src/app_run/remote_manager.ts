import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import type { RemoteMachineClientConnection } from "@/distributed_machines/remote_client";
import { IpcRemoteMachineConnection } from "@/distributed_machines/ipc_connection";
import { PreviewConsoleStore } from "@/preview_console/store";
import type { AppExit } from "./selectors";
import {
  appRunKey,
  projectAppRunRemoteSnapshot,
  type AppRunIntentEvent,
  type AppRunRemoteSnapshot,
} from "./transport";
import { appRunClientDefinition } from "./client_definition";

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

/**
 * Per-window adapter over main-hosted app-run actors.
 *
 * It owns only remote subscriptions and the independent console display
 * buffer. All lifecycle state and command execution live in main.
 */
export class AppRunRemoteManager {
  readonly previewConsole = new PreviewConsoleStore();
  private readonly client: RemoteMachineClient;
  private readonly actorUnsubscribes = new Map<number, () => void>();
  private readonly listeners = new Set<AppRunRemoteStateChangedListener>();
  private readonly appExitSnapshots = new Map<
    number,
    {
      source: AppRunRemoteSnapshot["exit"];
      value: AppExit;
    }
  >();
  private readonly settlementWaiters = new Map<
    string,
    { appId: number; resolve: () => void }
  >();
  private stopConnection?: () => void;
  private disposed = false;

  constructor(
    private readonly ids: IdSource = uuidIdSource,
    private readonly connection: RemoteMachineClientConnection & {
      start?: () => () => void;
    } = new IpcRemoteMachineConnection(),
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

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.actor(appId).subscribe(listener);

  getAppExitSnapshot = (appId: number): AppExit | null => {
    const exit = this.getSnapshot(appId).exit;
    if (!exit || exit.timestamp === null) {
      this.appExitSnapshots.delete(appId);
      return null;
    }
    const cached = this.appExitSnapshots.get(appId);
    if (cached?.source === exit) return cached.value;
    const value = {
      appId,
      exitCode: exit.exitCode,
      timestamp: exit.timestamp,
    };
    this.appExitSnapshots.set(appId, { source: exit, value });
    return value;
  };

  subscribeAppExit = (appId: number, listener: () => void): (() => void) =>
    this.subscribeKey(appId, listener);

  getReloadToken = (appId: number): number =>
    this.getSnapshot(appId).previewReloadEpoch;

  subscribeReloadToken = (appId: number, listener: () => void): (() => void) =>
    this.subscribeKey(appId, listener);

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
    let receipt = await actor.dispatch(event);
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
      receipt = await actor.dispatch(event);
    }
    if (receipt.kind === "rejected") {
      settlement.cancel();
      throw new Error(`App run request rejected: ${receipt.reason}`);
    }
    if (receipt.kind === "ignored") {
      settlement.cancel();
      return;
    }
    await settlement.promise;
  }

  requestManualReload = (appId: number): void => {
    this.start();
    const actor = this.actor(appId);
    void actor
      .resync()
      .then(() =>
        actor.dispatch({
          type: "MANUAL_RELOAD",
          operationId: this.ids.next("app-run-reload"),
          startedAt: Date.now(),
        }),
      )
      .catch((error) => {
        console.error("[app-run] Preview reload dispatch failed:", error);
      });
  };

  disposeKey = (appId: number): void => {
    this.actorUnsubscribes.get(appId)?.();
    this.actorUnsubscribes.delete(appId);
    this.appExitSnapshots.delete(appId);
    this.previewConsole.disposeKey(appId);
    this.resolveSettlementsForApp(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const unsubscribe of this.actorUnsubscribes.values()) unsubscribe();
    this.actorUnsubscribes.clear();
    this.appExitSnapshots.clear();
    this.listeners.clear();
    this.previewConsole.dispose();
    for (const waiter of this.settlementWaiters.values()) waiter.resolve();
    this.settlementWaiters.clear();
    this.client.dispose();
  }

  private actor(appId: number) {
    const actor = this.client.actor(appRunClientDefinition, appRunKey(appId));
    if (!this.actorUnsubscribes.has(appId)) {
      const unsubscribe = actor.subscribe(() => {
        const snapshot = actor.getSnapshot();
        const settlement = snapshot.lastSettlement;
        if (settlement) {
          this.settlementWaiters.get(settlement.operationId)?.resolve();
          this.settlementWaiters.delete(settlement.operationId);
        }
        for (const listener of this.listeners) {
          try {
            listener(appId, snapshot);
          } catch (error) {
            console.error("[app-run] Remote state listener failed:", error);
          }
        }
      });
      this.actorUnsubscribes.set(appId, unsubscribe);
    }
    return actor;
  }

  private waitForSettlement(appId: number, operationId: string) {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
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

  private resolveSettlementsForApp(appId: number): void {
    for (const [operationId, waiter] of this.settlementWaiters) {
      if (waiter.appId !== appId) continue;
      waiter.resolve();
      this.settlementWaiters.delete(operationId);
    }
  }
}

export const NO_APP_RUN_REMOTE_SNAPSHOT = projectAppRunRemoteSnapshot(1, 0, {
  type: "idle",
});
