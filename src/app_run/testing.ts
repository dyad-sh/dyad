import type { AppRunInvocationRef, RunState } from "./state";
import {
  AppRunIntentEventSchema,
  AppRunKeySchema,
  projectAppRunRemoteSnapshot,
  type AppRunIntentEvent,
  type AppRunRemoteSnapshot,
} from "./transport";
import type { AppRunRemoteConnection } from "./remote_manager";

type MachineAddress = Parameters<AppRunRemoteConnection["subscribe"]>[0];
type MachineDispatchEnvelope = Parameters<
  AppRunRemoteConnection["dispatch"]
>[0];
type MachineDispatchReceipt = Awaited<
  ReturnType<AppRunRemoteConnection["dispatch"]>
>;
type MachineSnapshotEnvelope = Awaited<
  ReturnType<AppRunRemoteConnection["subscribe"]>
>;

/**
 * Renderer-test transport for the main-owned app-run read model.
 *
 * It models remote bootstrap and producer settlement without reviving a
 * renderer lifecycle controller.
 */
export class TestAppRunRemoteConnection implements AppRunRemoteConnection {
  readonly dispatches: AppRunIntentEvent[] = [];
  onDispatch?: (appId: number, event: AppRunIntentEvent) => void;

  private readonly snapshots = new Map<number, AppRunRemoteSnapshot>();
  private readonly snapshotListeners = new Set<(payload: unknown) => void>();

  getStatus(): ReturnType<AppRunRemoteConnection["getStatus"]> {
    return "connected";
  }

  onStatusChange(): () => void {
    return () => undefined;
  }

  onSnapshot(listener: (payload: unknown) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onDisposed(): () => void {
    return () => undefined;
  }

  async subscribe(address: MachineAddress): Promise<MachineSnapshotEnvelope> {
    const appId = AppRunKeySchema.parse(address.encodedKey).appId;
    return this.envelope(address, this.snapshot(appId));
  }

  async unsubscribe(): Promise<void> {}

  async dispatch(
    envelope: MachineDispatchEnvelope,
  ): Promise<MachineDispatchReceipt> {
    const appId = AppRunKeySchema.parse(envelope.encodedKey).appId;
    const event = AppRunIntentEventSchema.parse(envelope.encodedEvent);
    this.dispatches.push(event);
    this.onDispatch?.(appId, event);

    switch (event.type) {
      case "START":
      case "RESTART": {
        const operation =
          event.type === "START"
            ? "run"
            : event.operation === "rebuild"
              ? "rebuild"
              : "restart";
        const invocationRef = this.invocation(appId, event.operationId);
        this.publishState(appId, {
          type: "starting",
          appId,
          invocationRef,
          operation,
          startedAt: event.startedAt,
          pendingUrl: null,
        });
        this.publishState(
          appId,
          {
            type: "ready",
            appId,
            invocationRef,
            url: {
              appUrl: "http://localhost:3210",
              originalUrl: "http://localhost:5173",
              mode: "host",
            },
          },
          {
            operationId: event.operationId,
            kind: "run",
            outcome: "succeeded",
          },
          true,
        );
        break;
      }
      case "STOP_REQUESTED":
        this.publishState(
          appId,
          {
            type: "stopped",
            appId,
            invocationRef: this.invocation(appId, event.operationId),
            exitCode: null,
            timestamp: null,
          },
          {
            operationId: event.operationId,
            kind: "stop",
            outcome: "succeeded",
          },
        );
        break;
      case "MANUAL_RELOAD": {
        const current = this.snapshot(appId);
        this.publishSnapshot({
          ...current,
          revision: current.revision + 1,
          previewReloadEpoch: current.previewReloadEpoch + 1,
        });
        break;
      }
    }

    const revision = this.snapshot(appId).revision;
    return {
      kind: "applied",
      actorInstanceId: this.actorInstanceId(appId),
      revision,
      transactionSequence: revision,
      messageId: envelope.messageId,
    };
  }

  publishStarting(
    appId: number,
    operationId: string,
    operation: "run" | "restart" | "rebuild",
    startedAt = 1,
  ): void {
    this.publishState(appId, {
      type: "starting",
      appId,
      invocationRef: this.invocation(appId, operationId),
      operation,
      startedAt,
      pendingUrl: null,
    });
  }

  private publishState(
    appId: number,
    state: RunState,
    settlement: AppRunRemoteSnapshot["lastSettlement"] = null,
    bumpReloadEpoch = false,
  ): void {
    const previous = this.snapshot(appId);
    this.publishSnapshot(
      projectAppRunRemoteSnapshot(
        appId,
        previous.revision + 1,
        state,
        previous.previewReloadEpoch + (bumpReloadEpoch ? 1 : 0),
        settlement,
      ),
    );
  }

  private publishSnapshot(snapshot: AppRunRemoteSnapshot): void {
    this.snapshots.set(snapshot.appId, snapshot);
    const envelope = this.envelope(
      {
        protocolVersion: 1,
        machineId: "app_run",
        encodedKey: { appId: snapshot.appId },
      },
      snapshot,
    );
    for (const listener of this.snapshotListeners) listener(envelope);
  }

  private snapshot(appId: number): AppRunRemoteSnapshot {
    const existing = this.snapshots.get(appId);
    if (existing) return existing;
    const initial = projectAppRunRemoteSnapshot(appId, 0, { type: "idle" });
    this.snapshots.set(appId, initial);
    return initial;
  }

  private envelope(
    address: MachineAddress,
    snapshot: AppRunRemoteSnapshot,
  ): MachineSnapshotEnvelope {
    return {
      ...address,
      actorInstanceId: this.actorInstanceId(snapshot.appId),
      revision: snapshot.revision,
      encodedState: snapshot,
    };
  }

  private actorInstanceId(appId: number): string {
    return `test-app-run-${appId}`;
  }

  private invocation(appId: number, operationId: string): AppRunInvocationRef {
    return { kind: "app-run", entityKey: appId, operationId };
  }
}
