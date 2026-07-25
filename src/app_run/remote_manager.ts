import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { RemoteMachineClient } from "@/distributed_machines/remote_client";
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
  private readonly connection = new IpcRemoteMachineConnection();
  private readonly client: RemoteMachineClient;
  private readonly actorUnsubscribes = new Map<number, () => void>();
  private readonly listeners = new Set<AppRunRemoteStateChangedListener>();
  private stopConnection?: () => void;
  private disposed = false;

  constructor(private readonly ids: IdSource = uuidIdSource) {
    this.client = new RemoteMachineClient(this.connection, ids);
  }

  start(): void {
    if (this.disposed || this.stopConnection) return;
    this.stopConnection = this.connection.start();
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
    return exit?.timestamp === null || !exit
      ? null
      : { appId, exitCode: exit.exitCode, timestamp: exit.timestamp };
  };

  subscribeAppExit = (appId: number, listener: () => void): (() => void) =>
    this.subscribeKey(appId, listener);

  getReloadToken = (appId: number): number => this.getSnapshot(appId).revision;

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
        event = input.options.removeNodeModules
          ? {
              type: "RESTART",
              operation: "rebuild",
              operationId: this.ids.next("app-run"),
              startedAt: input.startedAt,
              expectedRevision: snapshot.revision,
            }
          : {
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
    const receipt = await actor.dispatch(event);
    if (receipt.kind === "rejected") {
      throw new Error(`App run request rejected: ${receipt.reason}`);
    }
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
    this.previewConsole.disposeKey(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const unsubscribe of this.actorUnsubscribes.values()) unsubscribe();
    this.actorUnsubscribes.clear();
    this.listeners.clear();
    this.previewConsole.dispose();
    this.client.dispose();
  }

  private actor(appId: number) {
    const actor = this.client.actor(appRunClientDefinition, appRunKey(appId));
    if (!this.actorUnsubscribes.has(appId)) {
      const unsubscribe = actor.subscribe(() => {
        const snapshot = actor.getSnapshot();
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
}

export const NO_APP_RUN_REMOTE_SNAPSHOT = projectAppRunRemoteSnapshot(1, 0, {
  type: "idle",
});
