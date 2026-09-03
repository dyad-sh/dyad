import { db } from "@/db";
import { apps } from "@/db/schema";
import {
  defineFrameworkCoveredRemoteMachine,
  type DistributedMachineDefinition,
} from "@/distributed_machines/definition";
import {
  createOperationOutcomePublisher,
  finalizeOperationAdmission,
  type CorrelatedOperationOutcome,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";
import { defineRuntimeRemoteIntentContract } from "@/distributed_machines/remote_intent_contract";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { addLog } from "@/lib/log_store";
import { appRuntimeService } from "@/ipc/services/app_runtime_service";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type {
  AppRunIgnoreReason,
  AppRunInvocationRef,
  RunCommand,
  RunErrorInfo,
  RunEvent,
  RunState,
} from "./state";
import { APP_RUN_INVOCATION_KIND } from "./state";
import {
  AppRunIntentEventSchema,
  AppRunKeySchema,
  AppRunRemoteSnapshotSchema,
  appRunKey,
  projectAppRunRemoteSnapshot,
  type AppRunKey,
  type AppRunIntentEvent,
  type AppRunProducerEvent,
  type AppRunRemoteSnapshot,
  type AppRunWireEvent,
} from "./transport";
import { transition } from "./transition";
import { ignore } from "@/state_machines/types";
import { MainAppRuntimeOutput } from "@/ipc/services/main_app_runtime_output";
import {
  appRunOperationRegistry,
  type AppRunOperationOutcome,
} from "./operations";
import { appRunRemoteIntentContract } from "./remote_intent_contract";
import { sameInvocationRef } from "@/state_machines/invocation_ref";

export const APP_RUN_MACHINE_ID = "app_run" as const;

type CorrelatedRunCommand =
  | (Extract<RunCommand, { type: "start" | "stop" }> & {
      requestId: RequestId;
    })
  | Exclude<RunCommand, { type: "start" | "stop" }>;

function correlateCommand(
  command: RunCommand,
  event: AppRunActorEvent,
): CorrelatedRunCommand {
  if (command.type !== "start" && command.type !== "stop") return command;
  const requestId =
    ("requestId" in event && event.requestId) ||
    ("operationId" in event ? (event.operationId as RequestId) : undefined);
  if (!requestId) {
    throw new Error("App-run command is missing request correlation");
  }
  return {
    ...command,
    requestId,
  };
}

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
  state: AppRunActorState,
  event: AppRunActorEvent,
): RunEvent {
  switch (event.type) {
    case "START":
      return {
        type: "START",
        appId: key.appId,
        invocationRef:
          state.runState.type === "ready" || state.runState.type === "reloading"
            ? state.runState.invocationRef
            : state.runState.type === "errored" &&
                state.reusableStartInvocation &&
                isCurrentInvocation(
                  state.runState,
                  state.reusableStartInvocation,
                )
              ? state.reusableStartInvocation
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
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
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
  readonly observedExit: AppRunRemoteSnapshot["exit"];
  readonly reusableStartInvocation: AppRunInvocationRef | null;
  readonly lastSettlement: {
    readonly operationId: string;
    readonly kind: "run" | "stop";
    readonly outcome: "succeeded" | "failed";
    readonly error?: RunErrorInfo;
  } | null;
}

export type AppRunAdmittedIntent = AppRunIntentEvent & {
  readonly requestId?: RequestId;
  readonly windowSessionId?: string;
};

type AppRunCorrelatedProducerEvent = AppRunProducerEvent & {
  readonly requestId?: RequestId;
};

export type AppRunActorEvent =
  | AppRunAdmittedIntent
  | AppRunCorrelatedProducerEvent;

type AppRunCorrelatedOutcome = CorrelatedOperationOutcome<
  AppRunOperationOutcome,
  AppRunInvocationRef
>;

function settlementFor(
  event: AppRunActorEvent,
): AppRunActorState["lastSettlement"] {
  const requestId =
    ("requestId" in event && event.requestId) ||
    ("operationId" in event ? (event.operationId as RequestId) : undefined);
  if (!requestId) return null;
  switch (event.type) {
    case "PROCESS_SPAWNED":
      return {
        operationId: requestId,
        kind: "run",
        outcome: "succeeded",
      };
    case "PROCESS_FAILED":
      return {
        operationId: requestId,
        kind: "run",
        outcome: "failed",
        error: event.error,
      };
    case "PROCESS_STOPPED":
      return {
        operationId: requestId,
        kind: "stop",
        outcome: "succeeded",
      };
    case "PROCESS_STOP_FAILED":
      return {
        operationId: requestId,
        kind: "stop",
        outcome: "failed",
        error: event.error,
      };
    default:
      return null;
  }
}

export function resolveAppRunInvocationRef(
  key: AppRunKey,
  state: AppRunActorState,
  event: AppRunAdmittedIntent,
): AppRunInvocationRef {
  switch (event.type) {
    case "START":
      return state.runState.type === "ready" ||
        state.runState.type === "reloading"
        ? state.runState.invocationRef
        : state.runState.type === "errored" &&
            state.reusableStartInvocation &&
            isCurrentInvocation(state.runState, state.reusableStartInvocation)
          ? state.reusableStartInvocation
          : invocation(key.appId, event.operationId);
    case "RESTART":
    case "STOP_REQUESTED":
      return invocation(key.appId, event.operationId);
    case "MANUAL_RELOAD":
      throw new Error("Admission-only reloads do not create operations");
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function transitionActor(
  key: AppRunKey,
  state: AppRunActorState,
  event: AppRunActorEvent,
) {
  if ("invocationRef" in event && event.invocationRef.entityKey !== key.appId) {
    return ignore(state, "stale-operation");
  }
  if (
    event.type === "STOP_REQUESTED" &&
    !isCurrentInvocation(state.runState, event.activeInvocationRef)
  ) {
    return ignore(state, "stale-operation");
  }
  if (
    event.type === "HMR_DETECTED" &&
    !isCurrentInvocation(state.runState, event.invocationRef)
  ) {
    return ignore(state, "stale-operation");
  }
  const admittedExit =
    event.type === "PROCESS_EXITED" &&
    isCurrentInvocation(state.runState, event.invocationRef)
      ? {
          exitCode: event.exitCode,
          timestamp: event.timestamp,
        }
      : null;
  const result = transition(state.runState, toDomainEvent(key, state, event));
  const settlement =
    "invocationRef" in event &&
    !isCurrentInvocation(state.runState, event.invocationRef)
      ? null
      : settlementFor(event);
  const outcomes = settlement
    ? ([
        {
          requestId: settlement.operationId as RequestId,
          invocationRef: (
            event as AppRunCorrelatedProducerEvent & {
              readonly invocationRef: AppRunInvocationRef;
            }
          ).invocationRef,
          outcome:
            settlement.outcome === "succeeded"
              ? {
                  kind: "succeeded" as const,
                  operation: settlement.kind,
                }
              : {
                  kind: "failed" as const,
                  operation: settlement.kind,
                  error: settlement.error ?? {
                    message: "App runtime operation failed",
                  },
                },
        },
      ] satisfies AppRunCorrelatedOutcome[])
    : undefined;
  const observedExit =
    event.type === "START" ||
    event.type === "RESTART" ||
    event.type === "EXTERNAL_RESTART_STARTED"
      ? null
      : event.type === "PROCESS_EXITED"
        ? result.kind === "ignored"
          ? (admittedExit ?? state.observedExit)
          : null
        : state.observedExit;
  const reusableStartInvocation =
    event.type === "PROCESS_FAILED" &&
    event.runtimeMayBeLive === true &&
    isCurrentInvocation(state.runState, event.invocationRef)
      ? event.invocationRef
      : event.type === "PROCESS_FAILED" ||
          event.type === "START" ||
          event.type === "RESTART" ||
          event.type === "EXTERNAL_RESTART_STARTED" ||
          event.type === "PROCESS_EXITED"
        ? null
        : state.reusableStartInvocation;
  if (result.kind === "ignored") {
    return settlement || admittedExit
      ? {
          kind: "applied" as const,
          state: {
            ...state,
            observedExit,
            reusableStartInvocation,
            lastSettlement: settlement ?? state.lastSettlement,
          },
          commands: [],
          ...(outcomes ? { outcomes } : {}),
        }
      : { ...result, state };
  }
  const commands = result.commands.map((command) =>
    correlateCommand(command, event),
  );
  const bumpsPreviewReload = result.commands.some(
    (command) =>
      command.type === "applyUrl" ||
      command.type === "bumpReloadToken" ||
      command.type === "reload",
  );
  return {
    kind: "applied" as const,
    state:
      result.state === state.runState &&
      !bumpsPreviewReload &&
      !settlement &&
      observedExit === state.observedExit &&
      reusableStartInvocation === state.reusableStartInvocation
        ? state
        : {
            runState: result.state,
            previewReloadEpoch:
              state.previewReloadEpoch + (bumpsPreviewReload ? 1 : 0),
            observedExit,
            reusableStartInvocation,
            lastSettlement: settlement ?? state.lastSettlement,
          },
    commands,
    ...(outcomes ? { outcomes } : {}),
  };
}

async function appExists(appId: number): Promise<boolean> {
  const app = await db.query.apps.findFirst({
    columns: { id: true },
    where: eq(apps.id, appId),
  });
  return !!app;
}

export async function requireExistingApp(appId: number): Promise<void> {
  if (!(await appExists(appId))) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
}

async function authorizeApp(appId: number): Promise<void> {
  if (!(await appExists(appId))) {
    throw new DyadError("App not found", DyadErrorKind.Auth);
  }
}

function runErrorInfo(error: unknown): RunErrorInfo {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(isDyadError(error) ? { kind: error.kind } : {}),
  };
}

function createCommandRunner() {
  return (
    command: CorrelatedRunCommand,
    emitActorEvent: (event: AppRunActorEvent) => void,
  ): Promise<void> => {
    const emit = (event: AppRunCorrelatedProducerEvent) =>
      emitActorEvent(event);
    switch (command.type) {
      case "start": {
        if (command.operation !== "rebuild") {
          // Presentation stores consume this output independently in each
          // window; lifecycle state remains owned by the actor.
        }
        const runtimeBoundary =
          command.operation === "run" ? undefined : command.operation;
        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: START_LOG_MESSAGE[command.operation],
          appId: command.appId,
          timestamp: command.startedAt,
          runtimeBoundary,
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
          runtimeBoundary,
        });
        const operation = Promise.resolve().then(async () => {
          await (command.operation === "run"
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
              }));
          // Runtime lifecycle methods retain coordinator resources through
          // readiness. Keep this explicit wait as an idempotent actor-boundary
          // assertion and for compatibility with injected runtime facades.
          await appRuntimeService.waitForReady(command.appId);
        });
        return operation.then(
          () =>
            emit({
              type: "PROCESS_SPAWNED",
              operationId: command.invocationRef.operationId,
              requestId: command.requestId,
              invocationRef: command.invocationRef,
            }),
          (error) =>
            emit({
              type: "PROCESS_FAILED",
              operationId: command.invocationRef.operationId,
              requestId: command.requestId,
              invocationRef: command.invocationRef,
              error: runErrorInfo(error),
              runtimeMayBeLive: appRuntimeService.isRunning(command.appId),
            }),
        );
      }
      case "stop":
        return Promise.resolve()
          .then(() => appRuntimeService.stop(command.appId))
          .then(
            () =>
              emit({
                type: "PROCESS_STOPPED",
                operationId: command.invocationRef.operationId,
                requestId: command.requestId,
                invocationRef: command.invocationRef,
              }),
            (error) =>
              emit({
                type: "PROCESS_STOP_FAILED",
                operationId: command.invocationRef.operationId,
                requestId: command.requestId,
                invocationRef: command.invocationRef,
                error: runErrorInfo(error),
              }),
          );
      case "reload":
        emit({
          type: "RELOAD_COMPLETED",
          invocationRef: command.invocationRef,
        });
        return Promise.resolve();
      case "prepareExternalStart":
      case "applyUrl":
      case "bumpReloadToken":
      case "clearError":
      case "setError":
        return Promise.resolve();
    }
  };
}

export const appRunDefinition = defineFrameworkCoveredRemoteMachine({
  id: APP_RUN_MACHINE_ID,
  host: "main",
  initialState: (): AppRunActorState => ({
    runState: { type: "idle" },
    previewReloadEpoch: 0,
    observedExit: null,
    reusableStartInvocation: null,
    lastSettlement: null,
  }),
  transition: (state, event, key) => transitionActor(key, state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) void execute(command);
    },
  }),
  createCommandRunner,
  commandSinkRevisionPolicy: "allow-advance",
  createObserver: () => ({
    onTransitionApplied: ({ previous, state }) => {
      const previousRun = previous.runState;
      const nextRun = state.runState;
      if (
        previousRun.type === "idle" ||
        nextRun.type === "idle" ||
        sameInvocationRef(previousRun.invocationRef, nextRun.invocationRef)
      ) {
        return;
      }
      appRunOperationRegistry.settleSuperseded((identity) =>
        sameInvocationRef(identity.invocationRef, previousRun.invocationRef),
      );
    },
  }),
  createOutcomePublisher: (context) =>
    createOperationOutcomePublisher(appRunOperationRegistry, () => ({
      actor: context.getMetadata(),
      acknowledgedAt: Date.now(),
    })),
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
    settleWaiters: ({ metadata }) => {
      appRunOperationRegistry.settleActor(metadata.actorInstanceId);
    },
    onDisposed: ({ key }) => {
      appRuntimeService.cleanup(key.appId);
    },
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: AppRunKeySchema,
    encodeKey: (key) => key,
    canonicalizeKeyAfterAuthorization: (key) => appRunKey(key.appId),
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
        state.observedExit,
      ),
    unavailableSnapshot: (key) =>
      projectAppRunRemoteSnapshot(key.appId, 0, { type: "idle" }),
    revisionPolicy: (event) =>
      event.type === "START" || event.type === "RESTART"
        ? "reject-stale"
        : "allow-stale",
    authorizeSubscribe: ({ key }) => authorizeApp(key.appId),
    authorizeDispatch: async ({ key, event, currentState }) => {
      await authorizeApp(key.appId);
      if (
        event.type === "STOP_REQUESTED" &&
        !isCurrentInvocation(currentState?.runState, event.activeInvocationRef)
      ) {
        throw new DyadError(
          "Cancellation does not target the active app run",
          DyadErrorKind.Auth,
        );
      }
    },
  },
  remoteIntent: defineRuntimeRemoteIntentContract<
    AppRunKey,
    AppRunActorState,
    AppRunIntentEvent,
    AppRunActorEvent,
    AppRunRemoteSnapshot
  >({
    ...appRunRemoteIntentContract,
    keyToString: (key: AppRunKey) => String(key.appId),
    toInternalEvent: ({ intent, sender, requestIdentity }) => {
      if (!requestIdentity && intent.type !== "MANUAL_RELOAD") {
        throw new DyadError(
          "App run request identity is missing",
          DyadErrorKind.Validation,
        );
      }
      return Object.freeze({
        ...intent,
        ...(requestIdentity ? { requestId: requestIdentity.requestId } : {}),
        windowSessionId: sender.windowSessionId,
      }) as AppRunAdmittedIntent;
    },
    authorizeSubscribe: async ({ key }) => {
      try {
        await authorizeApp(key.appId);
        return { kind: "allow" as const };
      } catch (error) {
        if (isDyadError(error)) {
          return { kind: "deny" as const, error };
        }
        throw error;
      }
    },
    authorizeDispatch: async ({ key, intent, currentState }) => {
      try {
        await authorizeApp(key.appId);
        if (
          intent.type === "STOP_REQUESTED" &&
          !isCurrentInvocation(
            (currentState as AppRunActorState).runState,
            intent.activeInvocationRef,
          )
        ) {
          throw new DyadError(
            "Cancellation does not target the active app run",
            DyadErrorKind.Auth,
          );
        }
        return { kind: "allow" as const };
      } catch (error) {
        if (isDyadError(error)) {
          return { kind: "deny" as const, error };
        }
        throw error;
      }
    },
    finalizeOperation: (context, controls) => {
      const event = context.event as AppRunAdmittedIntent;
      const admission = finalizeOperationAdmission({
        registry: appRunOperationRegistry,
        identity: {
          requestId: context.requestIdentity.requestId,
          fingerprint: context.fingerprint,
          owner: {
            hostId: "main-remote-machine-host",
            machineId: APP_RUN_MACHINE_ID,
            keyId: String(context.key.appId),
            actorInstanceId: context.actor.actorInstanceId,
            actorRevision: context.actor.snapshotRevision,
            windowSessionId: context.sender.windowSessionId,
          },
        },
        createInvocationRef: () =>
          resolveAppRunInvocationRef(
            context.key,
            context.currentState as AppRunActorState,
            event,
          ),
        assertFinalAdmission: controls.assertFinalAdmission,
        enqueue: controls.enqueue,
        receiptOnEnqueueFailure: () => ({
          actor: context.actor,
          acknowledgedAt: Date.now(),
        }),
      });
      return admission.kind === "enqueued"
        ? {
            disposition: "fresh" as const,
            enqueueResult: admission.enqueueResult,
            operation: admission.operation,
            rollbackAdmission: (error: unknown) => {
              appRunOperationRegistry.rollbackAdmission(
                context.requestIdentity.requestId,
                admission.operation.invocationRef,
                error,
              );
            },
          }
        : {
            disposition: admission.kind,
            operation: admission.operation,
          };
    },
    disposeWindowSession: (windowSessionId) => {
      appRunOperationRegistry.settleWindowSession(windowSessionId);
    },
  }),
} satisfies DistributedMachineDefinition<
  typeof APP_RUN_MACHINE_ID,
  AppRunKey,
  AppRunActorState,
  AppRunActorEvent,
  CorrelatedRunCommand,
  AppRunIgnoreReason,
  AppRunIntentEvent,
  AppRunCorrelatedOutcome
>);
