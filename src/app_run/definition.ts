import { db } from "@/db";
import { apps } from "@/db/schema";
import type {
  DistributedMachineDefinition,
  MachineHostContext,
} from "@/distributed_machines/definition";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { addLog, clearLogs } from "@/lib/log_store";
import { appRuntimeService } from "@/ipc/services/app_runtime_service";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type {
  AppRunIgnoreReason,
  AppRunInvocationRef,
  RunCommand,
  RunEvent,
  RunState,
} from "./state";
import { APP_RUN_INVOCATION_KIND } from "./state";
import {
  AppRunIntentEventSchema,
  AppRunKeySchema,
  AppRunRemoteSnapshotSchema,
  projectAppRunRemoteSnapshot,
  type AppRunKey,
  type AppRunProducerEvent,
  type AppRunWireEvent,
} from "./transport";
import { transition } from "./transition";
import { ignore } from "@/state_machines/types";
import { MainAppRuntimeOutput } from "@/ipc/services/main_app_runtime_output";

export const APP_RUN_MACHINE_ID = "app_run" as const;

const START_LOG_MESSAGE = {
  run: "Connecting to app...",
  restart: "Restarting app...",
  rebuild: "Rebuilding app after pnpm install...",
} as const;

function invocation(appId: number, operationId: string): AppRunInvocationRef {
  return {
    kind: APP_RUN_INVOCATION_KIND,
    entityKey: appId,
    operationId,
  };
}

function toDomainEvent(
  key: AppRunKey,
  state: RunState,
  event: AppRunWireEvent,
): RunEvent {
  switch (event.type) {
    case "START":
      return {
        type: "START",
        appId: key.appId,
        invocationRef:
          state.type === "ready" || state.type === "reloading"
            ? state.invocationRef
            : invocation(key.appId, event.operationId),
        startedAt: event.startedAt,
      };
    case "RESTART":
      return event.operation === "rebuild"
        ? {
            type: "REBUILD",
            appId: key.appId,
            invocationRef: invocation(key.appId, event.operationId),
            startedAt: event.startedAt,
          }
        : {
            type: "RESTART",
            appId: key.appId,
            invocationRef: invocation(key.appId, event.operationId),
            startedAt: event.startedAt,
            options: event.options,
          };
    case "STOP_REQUESTED":
      return {
        type: "STOP",
        appId: key.appId,
        invocationRef: invocation(key.appId, event.operationId),
        startedAt: event.startedAt,
      };
    case "MANUAL_RELOAD":
      return { type: "MANUAL_RELOAD", appId: key.appId };
    case "EXTERNAL_RESTART_STARTED":
      return {
        type: "EXTERNAL_RESTART",
        appId: key.appId,
        invocationRef: event.invocationRef,
        operation: event.operation,
        startedAt: event.startedAt,
      };
    case "PROCESS_SPAWNED":
      return {
        type: "RUN_IPC_RESOLVED",
        invocationRef: event.invocationRef,
      };
    case "PROCESS_FAILED":
      return {
        type: "RUN_IPC_FAILED",
        invocationRef: event.invocationRef,
        error: event.error,
      };
    case "PROCESS_STOPPED":
      return {
        type: "STOP_IPC_RESOLVED",
        invocationRef: event.invocationRef,
      };
    case "PROCESS_STOP_FAILED":
      return {
        type: "STOP_IPC_FAILED",
        invocationRef: event.invocationRef,
        error: event.error,
      };
    case "PROXY_READY":
      return {
        type: "PROXY_READY",
        appId: key.appId,
        invocationRef: event.invocationRef,
        url: event.url,
      };
    case "HMR_DETECTED":
      return { type: "HMR_DETECTED", appId: key.appId };
    case "RELOAD_COMPLETED":
      return {
        type: "RELOAD_DONE",
        invocationRef: event.invocationRef,
      };
    case "PROCESS_EXITED":
      return {
        type: "APP_EXIT",
        appId: key.appId,
        invocationRef: event.invocationRef,
        exitCode: event.exitCode,
        timestamp: event.timestamp,
      };
  }
}

function isCurrentInvocation(
  state: RunState | undefined,
  ref: AppRunInvocationRef,
): boolean {
  return (
    state !== undefined &&
    state.type !== "idle" &&
    state.invocationRef.kind === ref.kind &&
    state.invocationRef.entityKey === ref.entityKey &&
    state.invocationRef.operationId === ref.operationId
  );
}

interface AppRunActorState {
  readonly runState: RunState;
  readonly previewReloadEpoch: number;
  readonly lastSettlement: {
    readonly operationId: string;
    readonly kind: "run" | "stop";
    readonly outcome: "succeeded" | "failed";
  } | null;
}

function settlementFor(
  event: AppRunWireEvent,
): AppRunActorState["lastSettlement"] {
  switch (event.type) {
    case "PROCESS_SPAWNED":
      return {
        operationId: event.invocationRef.operationId,
        kind: "run",
        outcome: "succeeded",
      };
    case "PROCESS_FAILED":
      return {
        operationId: event.invocationRef.operationId,
        kind: "run",
        outcome: "failed",
      };
    case "PROCESS_STOPPED":
      return {
        operationId: event.invocationRef.operationId,
        kind: "stop",
        outcome: "succeeded",
      };
    case "PROCESS_STOP_FAILED":
      return {
        operationId: event.invocationRef.operationId,
        kind: "stop",
        outcome: "failed",
      };
    default:
      return null;
  }
}

function transitionActor(
  key: AppRunKey,
  state: AppRunActorState,
  event: AppRunWireEvent,
) {
  if ("invocationRef" in event && event.invocationRef.entityKey !== key.appId) {
    return ignore(state, "stale-operation");
  }
  if (
    event.type === "HMR_DETECTED" &&
    !isCurrentInvocation(state.runState, event.invocationRef)
  ) {
    return ignore(state, "stale-operation");
  }
  const result = transition(
    state.runState,
    toDomainEvent(key, state.runState, event),
  );
  const settlement = settlementFor(event);
  if (result.kind === "ignored") {
    return settlement
      ? {
          kind: "applied" as const,
          state: { ...state, lastSettlement: settlement },
          commands: [],
        }
      : { ...result, state };
  }
  const bumpsPreviewReload = result.commands.some(
    (command) =>
      command.type === "applyUrl" ||
      command.type === "bumpReloadToken" ||
      command.type === "reload",
  );
  return {
    kind: "applied" as const,
    state:
      result.state === state.runState && !bumpsPreviewReload && !settlement
        ? state
        : {
            runState: result.state,
            previewReloadEpoch:
              state.previewReloadEpoch + (bumpsPreviewReload ? 1 : 0),
            lastSettlement: settlement ?? state.lastSettlement,
          },
    commands: result.commands,
  };
}

async function requireApp(appId: number): Promise<void> {
  const app = await db.query.apps.findFirst({
    columns: { id: true },
    where: eq(apps.id, appId),
  });
  if (!app) throw new DyadError("App not found", DyadErrorKind.Auth);
}

function createCommandRunner(
  context: MachineHostContext<AppRunKey, AppRunActorState, AppRunWireEvent>,
) {
  const emit = (event: AppRunProducerEvent) => context.send(event);
  return (command: RunCommand): void => {
    switch (command.type) {
      case "start": {
        if (command.operation !== "rebuild") {
          // Presentation stores consume this output independently in each
          // window; lifecycle state remains owned by the actor.
        }
        if (command.operation !== "run") {
          clearLogs(command.appId);
        }
        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: START_LOG_MESSAGE[command.operation],
          appId: command.appId,
          timestamp: command.startedAt,
        };
        addLog(logEntry);
        const output = new MainAppRuntimeOutput(
          command.appId,
          command.invocationRef,
          { send: emit },
        );
        output.enqueue({
          type: "info",
          message: logEntry.message,
          appId: command.appId,
          timestamp: command.startedAt,
          invocationRef: command.invocationRef,
        });
        const operation =
          command.operation === "run"
            ? appRuntimeService.start({
                appId: command.appId,
                invocationRef: command.invocationRef,
                output,
              })
            : appRuntimeService.restart({
                appId: command.appId,
                invocationRef: command.invocationRef,
                removeNodeModules: command.options.removeNodeModules,
                recreateSandbox: command.options.recreateSandbox,
                output,
              });
        void operation.then(
          () =>
            emit({
              type: "PROCESS_SPAWNED",
              invocationRef: command.invocationRef,
            }),
          (error) =>
            emit({
              type: "PROCESS_FAILED",
              invocationRef: command.invocationRef,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }),
        );
        return;
      }
      case "stop":
        void appRuntimeService.stop(command.appId).then(
          () =>
            emit({
              type: "PROCESS_STOPPED",
              invocationRef: command.invocationRef,
            }),
          (error) =>
            emit({
              type: "PROCESS_STOP_FAILED",
              invocationRef: command.invocationRef,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }),
        );
        return;
      case "reload":
        emit({
          type: "RELOAD_COMPLETED",
          invocationRef: command.invocationRef,
        });
        return;
      case "prepareExternalStart":
      case "applyUrl":
      case "bumpReloadToken":
      case "clearError":
      case "setError":
        return;
    }
  };
}

export const appRunDefinition = {
  id: APP_RUN_MACHINE_ID,
  host: "main",
  initialState: (): AppRunActorState => ({
    runState: { type: "idle" },
    previewReloadEpoch: 0,
    lastSettlement: null,
  }),
  transition: (state, event, key) => transitionActor(key, state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) void execute(command);
    },
  }),
  createCommandRunner,
  lifecycle: {
    subscriptionCreates: true,
    dispatchCreates: false,
    idleEviction: { kind: "retain" },
    terminalRetention: { kind: "retain" },
    entityDeletion: "dispose",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "ephemeral",
    flushOnShutdown: true,
    onDisposed: ({ key }) => {
      appRuntimeService.cleanup(key.appId);
    },
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: AppRunKeySchema,
    encodeKey: (key) => key,
    // Host-only producer events deliberately fail this renderer boundary.
    eventCodec: AppRunIntentEventSchema as z.ZodType<AppRunWireEvent>,
    snapshotCodec: AppRunRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    projectSnapshot: (state, key, metadata) =>
      projectAppRunRemoteSnapshot(
        key.appId,
        metadata.snapshotRevision,
        state.runState,
        state.previewReloadEpoch,
        state.lastSettlement,
      ),
    unavailableSnapshot: (key) =>
      projectAppRunRemoteSnapshot(key.appId, 0, { type: "idle" }),
    revisionPolicy: (event) =>
      event.type === "START" || event.type === "RESTART"
        ? "reject-stale"
        : "allow-stale",
    authorizeSubscribe: ({ key }) => requireApp(key.appId),
    authorizeDispatch: async ({ key, event, currentState }) => {
      await requireApp(key.appId);
      if (
        event.type === "STOP_REQUESTED" &&
        !isCurrentInvocation(currentState?.runState, event.activeInvocationRef)
      ) {
        throw new DyadError(
          "Cancellation does not target the active app run",
          DyadErrorKind.Auth,
        );
      }
      if (
        event.type === "MANUAL_RELOAD" &&
        currentState?.runState.type !== "ready"
      ) {
        throw new DyadError(
          "The app preview is not ready to reload",
          DyadErrorKind.Auth,
        );
      }
    },
  },
} satisfies DistributedMachineDefinition<
  typeof APP_RUN_MACHINE_ID,
  AppRunKey,
  AppRunActorState,
  AppRunWireEvent,
  RunCommand,
  AppRunIgnoreReason
>;
