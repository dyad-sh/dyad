import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import {
  RemoteMachineClient,
  RemoteMachineTransportError,
  type ObservedRevisionToken,
  type RemoteMachineClientConnection,
} from "@/distributed_machines/remote_client";
import {
  createRemoteRequestActor,
  dispatchRemoteAdmissionOnly,
} from "@/distributed_machines/request_actor";
import {
  PreparedRequestScope,
  type PreparedRequest,
  type PreparedRequestSettlement,
} from "@/distributed_machines/prepared_request";
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
import type { AppRunOperationOutcome } from "./operations";

export type AppRunRemoteConnection = RemoteMachineClientConnection & {
  start?: () => () => void;
};

export type AppRunRemoteStateChangedListener = (
  appId: number,
  state: AppRunRemoteSnapshot,
) => void;

export type AppRunOperationInput =
  | { type: "START"; startedAt: number }
  | {
      type: "RESTART";
      startedAt: number;
      options: { removeNodeModules: boolean };
    }
  | { type: "REBUILD"; startedAt: number }
  | { type: "STOP"; startedAt: number };

export type AppRunAdmission = { readonly kind: "accepted" };
export type AppRunRefusal = string;

type PreparedRunOperation = AppRunOperationInput & {
  readonly observed?: ObservedRevisionToken;
};

export type AppRunPreparedRequest = PreparedRequest<
  AppRunAdmission,
  AppRunOperationOutcome,
  AppRunRefusal
>;

/**
 * Per-window adapter over main-hosted app-run actors.
 *
 * It owns only remote subscriptions and the independent console display
 * buffer. All lifecycle state and command execution live in main.
 */
export class AppRunRemoteManager {
  readonly previewConsole = new PreviewConsoleStore();
  private readonly client: RemoteMachineClient;
  private readonly requestScope: PreparedRequestScope;
  private readonly listeners = new Set<AppRunRemoteStateChangedListener>();
  private stopConnection?: () => void;
  private disposed = false;

  constructor(
    private readonly ids: IdSource = uuidIdSource,
    private readonly connection: AppRunRemoteConnection = new IpcRemoteMachineConnection(),
  ) {
    this.client = new RemoteMachineClient(this.connection, ids);
    this.requestScope = new PreparedRequestScope(
      this.ids.next("app-run-window-session"),
    );
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

  getView = (appId: number) => this.actor(appId).getView();

  subscribeKey = (appId: number, listener: () => void): (() => void) => {
    const actor = this.actor(appId);
    return actor.subscribe(() => {
      this.handleActorSnapshot(appId, actor.getSnapshot());
      listener();
    });
  };

  subscribeRunStateChanged = (
    listener: AppRunRemoteStateChangedListener,
  ): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async dispatch(appId: number, input: AppRunOperationInput): Promise<void> {
    const prepared = this.prepareRequest(appId, input);
    void prepared.admission.catch(() => undefined);
    return this.settlePreparedRequest(appId, input, prepared);
  }

  prepareRequest(
    appId: number,
    input: AppRunOperationInput,
    capturedObserved?: ObservedRevisionToken,
  ): AppRunPreparedRequest {
    this.start();
    const actor = this.actor(appId);
    const view = actor.getView();
    const observed =
      capturedObserved ??
      (view.snapshot.kind === "available"
        ? view.snapshot.observedRevision
        : undefined);
    let runtimeOperationId: string | undefined;
    const requestActor = createRemoteRequestActor<
      PreparedRunOperation,
      AppRunIntentEvent,
      AppRunRemoteSnapshot,
      string,
      AppRunAdmission,
      AppRunOperationOutcome,
      AppRunRefusal
    >({
      actor,
      scope: this.requestScope,
      ids: this.ids,
      windowSessionId: this.requestScope.windowSessionId,
      snapshotInput: (operation) => Object.freeze(structuredClone(operation)),
      prepareIntent: (operation) => {
        const currentView = actor.getView();
        const currentObserved =
          currentView.snapshot.kind === "available"
            ? currentView.snapshot.observedRevision
            : undefined;
        const expectedRevision =
          operation.observed?.kind === "actor"
            ? operation.observed.revision
            : currentObserved?.kind === "actor"
              ? currentObserved.revision
              : currentView.state.revision;
        let event: AppRunIntentEvent;
        runtimeOperationId ??= this.ids.next("app-run-invocation");
        switch (operation.type) {
          case "START":
            event = {
              type: "START",
              operationId: runtimeOperationId,
              startedAt: operation.startedAt,
              expectedRevision,
            };
            break;
          case "RESTART":
            event = {
              type: "RESTART",
              operation: "restart",
              operationId: runtimeOperationId,
              startedAt: operation.startedAt,
              expectedRevision,
              options: operation.options,
            };
            break;
          case "REBUILD":
            event = {
              type: "RESTART",
              operation: "rebuild",
              operationId: runtimeOperationId,
              startedAt: operation.startedAt,
              expectedRevision,
            };
            break;
          case "STOP":
            if (!currentView.state.invocationRef) {
              return { kind: "refused", reason: "not-running" };
            }
            event = {
              type: "STOP_REQUESTED",
              operationId: runtimeOperationId,
              startedAt: operation.startedAt,
              activeInvocationRef: currentView.state.invocationRef,
            };
            break;
        }
        return {
          intent: event,
          expected: operation.observed ?? currentObserved,
        };
      },
      fingerprint: (_identity, operation) =>
        JSON.stringify({ appId, operation }),
      selectOutcome: (current, requestId) => {
        const settlement = current.state.lastSettlement;
        if (
          !settlement ||
          (settlement.operationId !== requestId &&
            settlement.operationId !== runtimeOperationId)
        ) {
          return undefined;
        }
        return settlement.outcome === "succeeded"
          ? { kind: "succeeded", operation: settlement.kind }
          : {
              kind: "failed",
              operation: settlement.kind,
              error: settlement.error ?? {
                message: "App runtime operation failed",
              },
            };
      },
      observeView: (current) => this.handleActorSnapshot(appId, current.state),
      outcomeOnUnavailable: () => ({
        kind: "cancelled",
        reason: "actor-disposed",
      }),
      admissionFromReceipt: (receipt) =>
        receipt.kind === "rejected" || receipt.kind === "ignored"
          ? { kind: "refused", reason: String(receipt.reason) }
          : { kind: "accepted" },
      isRefusal: (value): value is { kind: "refused"; reason: AppRunRefusal } =>
        value.kind === "refused",
      classifyFailure: (error) =>
        error instanceof RemoteMachineTransportError &&
        (error.code === "disconnected" || error.code === "renderer-destroyed")
          ? {
              kind: "disconnect",
              retryable: false,
              admission: "unknown",
            }
          : { kind: "unexpected" },
      retry: { kind: "none" },
    });
    return requestActor.request({
      ...input,
      observed,
    });
  }

  async settlePreparedRequest(
    appId: number,
    input: AppRunOperationInput,
    prepared: AppRunPreparedRequest,
    settlement?: PreparedRequestSettlement<
      AppRunOperationOutcome,
      AppRunRefusal
    >,
  ): Promise<void> {
    const result = settlement ?? (await prepared.settled);
    return this.applyPublicSettlement(appId, input, result);
  }

  async applyPublicSettlement(
    appId: number,
    input: AppRunOperationInput,
    result: PreparedRequestSettlement<AppRunOperationOutcome, AppRunRefusal>,
    allowRevisionRetry = true,
  ): Promise<void> {
    if (result.kind === "not-admitted") {
      if (input.type === "START" && result.refusal === "revision-conflict") {
        const actor = this.actor(appId);
        const lease = actor.retain();
        try {
          await lease.ready;
          await actor.resync();
          const latest = actor.getSnapshot();
          if (
            latest.phase === "starting" ||
            latest.phase === "ready" ||
            latest.phase === "reloading"
          ) {
            return;
          }
        } finally {
          lease.release();
        }
        if (allowRevisionRetry) {
          const retry = this.prepareRequest(appId, input);
          void retry.admission.catch(() => undefined);
          const settlement = await retry.settled;
          return this.applyPublicSettlement(appId, input, settlement, false);
        }
      }
      if (result.refusal === "not-running") return;
      if (result.refusal === "host-disposing") return;
      if (result.reason === "disposed") return;
      throw new Error(
        `App run request rejected: ${result.refusal ?? result.reason}`,
      );
    }
    if (result.kind === "detached") return;
    if (result.outcome.kind === "cancelled") return;
    if (result.outcome.kind === "failed") {
      const error = result.outcome.error;
      if (error.kind) throw new DyadError(error.message, error.kind);
      throw new Error(error.message);
    }
  }

  requestManualReload = (appId: number): void => {
    this.start();
    const actor = this.actor(appId);
    void (async () => {
      try {
        const receipt = await dispatchRemoteAdmissionOnly(actor, {
          type: "MANUAL_RELOAD",
          operationId: this.ids.next("app-run-reload"),
          startedAt: Date.now(),
        });
        if (receipt.kind === "rejected") {
          throw new Error(`App reload request rejected: ${receipt.reason}`);
        }
      } catch (error) {
        console.error("[app-run] Preview reload dispatch failed:", error);
      }
    })();
  };

  disposeKey = (appId: number): void => {
    this.previewConsole.disposeKey(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.previewConsole.dispose();
    this.requestScope.dispose();
    this.client.dispose();
  }

  private actor(appId: number) {
    return this.client.actor(appRunClientDefinition, appRunKey(appId));
  }

  private handleActorSnapshot(
    appId: number,
    snapshot: AppRunRemoteSnapshot,
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(appId, snapshot);
      } catch (error) {
        console.error("[app-run] Remote state listener failed:", error);
      }
    }
  }
}

export const NO_APP_RUN_REMOTE_SNAPSHOT = projectAppRunRemoteSnapshot(1, 0, {
  type: "idle",
});
