import { appRunKey, type AppRunIntentEvent } from "@/app_run/transport";
import {
  appRunDefinition,
  requireExistingApp,
  resolveAppRunInvocationRef,
  type AppRunAdmittedIntent,
  type AppRunActorEvent,
} from "@/app_run/definition";
import { MainAppRuntimeOutput } from "./main_app_runtime_output";
import type { AppRunInvocationRef } from "@/app_run/state";
import { appRuntimeService } from "./app_runtime_service";
import { remoteMachineHost } from "./distributed_machine_actor_host";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  finalizeOperationAdmission,
  type OperationTicket,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";
import {
  appRunOperationRegistry,
  type AppRunOperationOutcome,
} from "@/app_run/operations";
import type { FenceHandle } from "@/distributed_machines/keyed_admission_gate";
import type { ActorMachineFenceHandle } from "@/distributed_machines/actor_host";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";

type AppRunActorHost = Pick<
  typeof remoteMachineHost,
  | "ensure"
  | "peek"
  | "disposeKey"
  | "disposeMachine"
  | "dispose"
  | "beginFence"
  | "beginMachineFence"
>;

function isAppRunDrainEvent(event: AppRunActorEvent): boolean {
  return (
    event.type === "PROCESS_SPAWNED" ||
    event.type === "PROCESS_FAILED" ||
    event.type === "PROCESS_STOPPED" ||
    event.type === "PROCESS_STOP_FAILED" ||
    event.type === "PROCESS_EXITED" ||
    event.type === "PROXY_READY"
  );
}

export class AppRunActorService {
  constructor(
    private readonly host: AppRunActorHost = remoteMachineHost,
    private readonly ids: IdSource = uuidIdSource,
  ) {}

  actor(appId: number) {
    return this.host.ensure(appRunDefinition, appRunKey(appId));
  }

  async getRunState(appId: number) {
    await requireExistingApp(appId);
    return this.actor(appId).getSnapshot().runState;
  }

  outputFor(
    appId: number,
    invocationRef: AppRunInvocationRef,
  ): MainAppRuntimeOutput {
    const key = appRunKey(appId);
    const actor = this.host.peek(appRunDefinition.id, key);
    if (!actor) {
      throw new DyadError(
        "App run actor is not available",
        DyadErrorKind.Precondition,
      );
    }
    const sink = actor.captureSink();
    return new MainAppRuntimeOutput(appId, invocationRef, {
      send: sink.send,
    });
  }

  async outputForCurrentRun(
    appId: number,
    fallbackInvocationRef?: AppRunInvocationRef,
  ): Promise<MainAppRuntimeOutput> {
    await requireExistingApp(appId);
    const state = this.actor(appId).getSnapshot().runState;
    const invocationRef =
      state.type === "idle"
        ? (fallbackInvocationRef ??
          appRuntimeService.createExternalLifecycleRef(appId))
        : state.invocationRef;
    return this.outputFor(appId, invocationRef);
  }

  async dispatchStart(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    await this.dispatchAndWait(appId, input.operationId, {
      type: "START",
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    });
  }

  async dispatchRestart(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      removeNodeModules: boolean;
      recreateSandbox: boolean;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    const common = {
      type: "RESTART" as const,
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    };
    await this.dispatchAndWait(appId, input.operationId, {
      ...common,
      operation: "restart",
      options: {
        removeNodeModules: input.removeNodeModules,
        recreateSandbox: input.recreateSandbox,
      },
    });
  }

  async dispatchStop(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      activeInvocationRef: AppRunInvocationRef;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    await this.dispatchAndWait(appId, input.operationId, {
      type: "STOP_REQUESTED",
      operationId: input.operationId,
      startedAt: input.startedAt,
      activeInvocationRef: input.activeInvocationRef,
    });
  }

  async executeExternalLifecycle(options: {
    appId: number;
    operation: "restart" | "rebuild";
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
    await requireExistingApp(options.appId);
    this.actor(options.appId);
    const invocationRef = appRuntimeService.createExternalLifecycleRef(
      options.appId,
    );
    await appRuntimeService.executeExternalLifecycle({
      ...options,
      invocationRef,
      output: this.outputFor(options.appId, invocationRef),
    });
  }

  /**
   * Runs the process-replacement portion of an external restart when the
   * caller already owns the app runtime lock.
   *
   * The ordinary external lifecycle path acquires that lock itself, so using
   * it from isolated database setup would deadlock. This adapter still gives
   * the replacement a fresh actor-owned invocation and publishes correlated
   * terminal producer events around the caller's already-locked work.
   */
  async executeAlreadyLockedExternalRestart<T>(
    appId: number,
    execute: (context: {
      invocationRef: AppRunInvocationRef;
      output: MainAppRuntimeOutput;
    }) => Promise<T>,
  ): Promise<T> {
    await requireExistingApp(appId);
    const actor = this.actor(appId);
    const sink = actor.captureSink();
    const invocationRef = appRuntimeService.createExternalLifecycleRef(appId);
    const output = new MainAppRuntimeOutput(appId, invocationRef, sink);
    return actor.trackCaptured(sink, async () => {
      sink.send({
        type: "EXTERNAL_RESTART_STARTED",
        invocationRef,
        operation: "restart",
        startedAt: Date.now(),
      });
      try {
        const result = await execute({ invocationRef, output });
        sink.send({
          type: "PROCESS_SPAWNED",
          operationId: invocationRef.operationId,
          invocationRef,
        });
        return result;
      } catch (error) {
        sink.send({
          type: "PROCESS_FAILED",
          operationId: invocationRef.operationId,
          invocationRef,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    });
  }

  beginAppDeletion(appId: number): FenceHandle<ReturnType<typeof appRunKey>> {
    return this.host.beginFence(appRunDefinition, {
      key: appRunKey(appId),
      allowDuringDrain: isAppRunDrainEvent,
    });
  }

  beginReset(): ActorMachineFenceHandle {
    return this.host.beginMachineFence(appRunDefinition, {
      allowDuringDrain: (event) =>
        isAppRunDrainEvent(event as AppRunActorEvent),
    });
  }

  async disposeApp(appId: number): Promise<void> {
    appRunOperationRegistry.settleKey(
      "main-remote-machine-host",
      appRunDefinition.id,
      String(appId),
    );
    await this.host.disposeKey(
      appRunDefinition.id,
      appRunKey(appId),
      "entity-deletion",
    );
  }

  disposeAllApps(): Promise<void> {
    appRunOperationRegistry.settleMachine(
      "main-remote-machine-host",
      appRunDefinition.id,
    );
    return this.host.disposeMachine(appRunDefinition.id);
  }

  dispose(): Promise<void> {
    appRunOperationRegistry.settleHost("main-remote-machine-host");
    return this.host.dispose();
  }

  private async dispatchAndWait(
    appId: number,
    operationId: string,
    event: AppRunIntentEvent,
  ): Promise<void> {
    const actor = this.actor(appId);
    const requestId = this.ids.next("app-run-ipc-request") as RequestId;
    const admittedEvent = {
      ...event,
      requestId,
      windowSessionId: "main-ipc",
    } as AppRunActorEvent;
    let invocationRef!: AppRunInvocationRef;
    const metadata = actor.getMetadata();
    const admission = finalizeOperationAdmission({
      registry: appRunOperationRegistry,
      identity: {
        requestId,
        fingerprint: JSON.stringify({ appId, event }),
        owner: {
          hostId: "main-remote-machine-host",
          machineId: appRunDefinition.id,
          keyId: String(appId),
          actorInstanceId: metadata.actorInstanceId,
          actorRevision: metadata.snapshotRevision,
          windowSessionId: "main-ipc",
        },
      },
      createInvocationRef: () => {
        invocationRef = resolveAppRunInvocationRef(
          appRunKey(appId),
          actor.getSnapshot(),
          admittedEvent as AppRunAdmittedIntent,
        );
        return invocationRef;
      },
      assertFinalAdmission: () => {
        if (this.host.peek(appRunDefinition.id, appRunKey(appId)) !== actor) {
          throw new DyadError(
            "App run actor was replaced",
            DyadErrorKind.Precondition,
          );
        }
      },
      enqueue: () => actor.enqueue(admittedEvent),
      receiptOnEnqueueFailure: () => ({
        actor: metadata,
        acknowledgedAt: Date.now(),
      }),
    });
    const ticket: OperationTicket<AppRunOperationOutcome, AppRunInvocationRef> =
      admission.operation;
    if (admission.kind === "enqueued") {
      const dispatch = await admission.enqueueResult.settled;
      if (dispatch.kind === "failed") throw dispatch.error;
      if (dispatch.kind === "disposed" || dispatch.kind === "ignored") {
        appRunOperationRegistry.settle(
          requestId,
          invocationRef,
          dispatch.kind === "ignored"
            ? {
                kind: "failed",
                operation: event.type === "STOP_REQUESTED" ? "stop" : "run",
                error: {
                  message: `App run request was ignored: ${dispatch.reason}`,
                  kind: DyadErrorKind.Conflict,
                },
              }
            : {
                kind: "cancelled",
                reason: "actor-disposed",
              },
          {
            actor: admission.enqueueResult.getSettledMetadata() ?? metadata,
            acknowledgedAt: Date.now(),
          },
        );
      }
    }
    const settlement = await ticket.settled;
    if (settlement.outcome.kind === "failed") {
      const error = settlement.outcome.error;
      if (error.kind) throw new DyadError(error.message, error.kind);
      throw new Error(error.message);
    }
    if (settlement.outcome.kind === "cancelled") {
      throw new DyadError(
        settlement.outcome.reason === "superseded"
          ? "App run request was superseded"
          : "App run actor was disposed",
        DyadErrorKind.Precondition,
      );
    }
  }
}

export const appRunActorService = new AppRunActorService();
