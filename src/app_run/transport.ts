import { z } from "zod";
import { RuntimeMode2Schema } from "@/lib/schemas";
import type { RunState } from "./state";
import { APP_RUN_INVOCATION_KIND } from "./state";

const finiteTimestampSchema = z.number().finite().nonnegative();
const operationIdSchema = z.string().min(1);
const expectedRevisionSchema = z.number().int().nonnegative();

/**
 * Entity key accepted by the future app-run actor transport.
 *
 * This schema is intentionally independent from the generic actor transport:
 * it is the per-definition authorization/routing key that C1.3 will register.
 */
export const AppRunKeySchema = z
  .object({
    appId: z.number().int().positive(),
  })
  .strict();
export type AppRunKey = z.infer<typeof AppRunKeySchema>;

export const AppRunInvocationRefSchema = z
  .object({
    kind: z.literal(APP_RUN_INVOCATION_KIND),
    entityKey: z.number().int().positive(),
    operationId: operationIdSchema,
  })
  .strict();
export type AppRunWireInvocationRef = z.infer<typeof AppRunInvocationRefSchema>;

const restartOptionsSchema = z
  .object({
    removeNodeModules: z.boolean(),
    recreateSandbox: z.boolean(),
  })
  .strict();

const runUrlSchema = z
  .object({
    appUrl: z.string().min(1),
    originalUrl: z.string().min(1),
    mode: RuntimeMode2Schema,
  })
  .strict();

const runErrorSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (value instanceof Error) {
      context.addIssue({
        code: "custom",
        message: "Error instances are not wire-safe",
      });
    }
  })
  .pipe(
    z
      .object({
        message: z.string(),
      })
      .strict(),
  );

const startIntentSchema = z
  .object({
    type: z.literal("START"),
    operationId: operationIdSchema,
    startedAt: finiteTimestampSchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

const restartIntentBase = {
  type: z.literal("RESTART"),
  operationId: operationIdSchema,
  startedAt: finiteTimestampSchema,
  expectedRevision: expectedRevisionSchema,
};

const restartIntentSchema = z.union([
  z
    .object({
      ...restartIntentBase,
      operation: z.literal("restart"),
      options: restartOptionsSchema,
    })
    .strict(),
  z
    .object({
      ...restartIntentBase,
      operation: z.literal("rebuild"),
    })
    .strict(),
]);

const stopRequestedIntentSchema = z
  .object({
    type: z.literal("STOP_REQUESTED"),
    /**
     * Identity of this cancellation request. It is distinct from the active
     * invocation being targeted below.
     */
    operationId: operationIdSchema,
    startedAt: finiteTimestampSchema,
    activeInvocationRef: AppRunInvocationRefSchema,
  })
  .strict();

const manualReloadIntentSchema = z
  .object({
    type: z.literal("MANUAL_RELOAD"),
    operationId: operationIdSchema,
    startedAt: finiteTimestampSchema,
  })
  .strict();

/**
 * The complete renderer-dispatch allowlist for app-run. Adding a remote
 * intent requires adding a strict variant here and classifying it below.
 */
export const AppRunIntentEventSchema = z.union([
  startIntentSchema,
  restartIntentSchema,
  stopRequestedIntentSchema,
  manualReloadIntentSchema,
]);
export type AppRunIntentEvent = z.infer<typeof AppRunIntentEventSchema>;

/**
 * Per-definition admission boundary assembled after the generic actor
 * transport decodes its key and event independently. The key is the sole app
 * identity for renderer intents; cancellation additionally proves that its
 * active invocation belongs to that key.
 */
export const AppRunDispatchSchema = z
  .object({
    key: AppRunKeySchema,
    event: AppRunIntentEventSchema,
  })
  .strict()
  .superRefine((dispatch, context) => {
    if (
      dispatch.event.type === "STOP_REQUESTED" &&
      dispatch.event.activeInvocationRef.entityKey !== dispatch.key.appId
    ) {
      context.addIssue({
        code: "custom",
        path: ["event", "activeInvocationRef", "entityKey"],
        message: "Cancellation target must belong to the routed app",
      });
    }
  });
export type AppRunDispatch = z.infer<typeof AppRunDispatchSchema>;

const externalRestartStartedSchema = z
  .object({
    type: z.literal("EXTERNAL_RESTART_STARTED"),
    invocationRef: AppRunInvocationRefSchema,
    startedAt: finiteTimestampSchema,
    operation: z.enum(["restart", "rebuild"]),
  })
  .strict();

const processSpawnedSchema = z
  .object({
    type: z.literal("PROCESS_SPAWNED"),
    invocationRef: AppRunInvocationRefSchema,
  })
  .strict();

const processFailedSchema = z
  .object({
    type: z.literal("PROCESS_FAILED"),
    invocationRef: AppRunInvocationRefSchema,
    error: runErrorSchema,
  })
  .strict();

const processStoppedSchema = z
  .object({
    type: z.literal("PROCESS_STOPPED"),
    invocationRef: AppRunInvocationRefSchema,
  })
  .strict();

const processStopFailedSchema = z
  .object({
    type: z.literal("PROCESS_STOP_FAILED"),
    invocationRef: AppRunInvocationRefSchema,
    error: runErrorSchema,
  })
  .strict();

const proxyReadySchema = z
  .object({
    type: z.literal("PROXY_READY"),
    invocationRef: AppRunInvocationRefSchema,
    url: runUrlSchema,
  })
  .strict();

const hmrDetectedSchema = z
  .object({
    type: z.literal("HMR_DETECTED"),
    invocationRef: AppRunInvocationRefSchema,
  })
  .strict();

const reloadCompletedSchema = z
  .object({
    type: z.literal("RELOAD_COMPLETED"),
    invocationRef: AppRunInvocationRefSchema,
  })
  .strict();

const processExitedSchema = z
  .object({
    type: z.literal("PROCESS_EXITED"),
    invocationRef: AppRunInvocationRefSchema,
    exitCode: z.number().int().nullable(),
    timestamp: finiteTimestampSchema,
  })
  .strict();

/**
 * The complete trusted-main producer/settlement allowlist for app-run.
 * Producer events are never admitted from a renderer dispatch.
 */
export const AppRunProducerEventSchema = z.discriminatedUnion("type", [
  externalRestartStartedSchema,
  processSpawnedSchema,
  processFailedSchema,
  processStoppedSchema,
  processStopFailedSchema,
  proxyReadySchema,
  hmrDetectedSchema,
  reloadCompletedSchema,
  processExitedSchema,
]);
export type AppRunProducerEvent = z.infer<typeof AppRunProducerEventSchema>;

export const AppRunWireEventSchema = z.union([
  AppRunIntentEventSchema,
  AppRunProducerEventSchema,
]);
export type AppRunWireEvent = z.infer<typeof AppRunWireEventSchema>;

export type AppRunRemoteIntentClass =
  | "idempotent"
  | "state-sensitive"
  | "cancellation"
  | "presentation-only";

/**
 * Admission annotations for every renderer-dispatchable event. Producer
 * events are deliberately absent because their admission is host-only.
 *
 * No current RunEvent is presentation-only: presentation effects are commands
 * today and become post-commit consumers in C1.3.
 */
export const APP_RUN_REMOTE_INTENT_CLASS = {
  START: "state-sensitive",
  RESTART: "state-sensitive",
  STOP_REQUESTED: "cancellation",
  MANUAL_RELOAD: "idempotent",
} as const satisfies Record<AppRunIntentEvent["type"], AppRunRemoteIntentClass>;

const appRunCapabilitiesSchema = z
  .object({
    canStart: z.boolean(),
    canRestart: z.boolean(),
    canRebuild: z.boolean(),
    canStop: z.boolean(),
    canReload: z.boolean(),
  })
  .strict();

const appRunExitSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    timestamp: finiteTimestampSchema.nullable(),
  })
  .strict();

/**
 * Renderer-safe app-run lifecycle read model. This is a projection, not the
 * authoritative RunState and not a bag for command/runtime internals.
 */
export const AppRunRemoteSnapshotSchema = z
  .object({
    appId: z.number().int().positive(),
    revision: expectedRevisionSchema,
    phase: z.enum([
      "idle",
      "starting",
      "ready",
      "reloading",
      "stopping",
      "stopped",
      "errored",
    ]),
    operation: z
      .enum(["run", "restart", "rebuild", "stop", "reload"])
      .nullable(),
    startedAt: finiteTimestampSchema.nullable(),
    url: runUrlSchema.nullable(),
    operationError: runErrorSchema.nullable(),
    exit: appRunExitSchema.nullable(),
    capabilities: appRunCapabilitiesSchema,
    invocationRef: AppRunInvocationRefSchema.nullable(),
  })
  .strict();
export type AppRunRemoteSnapshot = z.infer<typeof AppRunRemoteSnapshotSchema>;

/**
 * Pure C1.3-ready mapping from authoritative state into its safe wire view.
 * Supplying the actor revision keeps revision ownership outside RunState.
 */
export function projectAppRunRemoteSnapshot(
  appId: number,
  revision: number,
  state: RunState,
): AppRunRemoteSnapshot {
  if (
    state.type !== "idle" &&
    (state.appId !== appId || state.invocationRef.entityKey !== appId)
  ) {
    throw new Error("App-run projection state does not match its actor key");
  }

  const base = {
    appId,
    revision,
    phase: state.type,
    operation: null,
    startedAt: null,
    url: null,
    operationError: null,
    exit: null,
    capabilities: selectRemoteCapabilities(state),
    invocationRef: state.type === "idle" ? null : state.invocationRef,
  } satisfies AppRunRemoteSnapshot;

  switch (state.type) {
    case "idle":
      return base;
    case "starting":
      return {
        ...base,
        operation: state.operation,
        startedAt: state.startedAt,
      };
    case "ready":
      return { ...base, url: state.url };
    case "reloading":
      return { ...base, operation: "reload", url: state.url };
    case "stopping":
      return { ...base, operation: "stop", startedAt: state.startedAt };
    case "stopped":
      return {
        ...base,
        exit:
          state.timestamp === null
            ? null
            : {
                exitCode: state.exitCode,
                timestamp: state.timestamp,
              },
      };
    case "errored":
      return { ...base, operationError: state.error };
    default:
      return assertNever(state);
  }
}

function selectRemoteCapabilities(
  state: RunState,
): AppRunRemoteSnapshot["capabilities"] {
  switch (state.type) {
    case "idle":
    case "stopped":
      return {
        canStart: true,
        canRestart: false,
        canRebuild: false,
        canStop: false,
        canReload: false,
      };
    case "starting":
      return {
        canStart: false,
        canRestart: true,
        canRebuild: true,
        canStop: true,
        canReload: false,
      };
    case "ready":
      return {
        canStart: false,
        canRestart: true,
        canRebuild: true,
        canStop: true,
        canReload: true,
      };
    case "reloading":
      return {
        canStart: false,
        canRestart: true,
        canRebuild: true,
        canStop: true,
        canReload: false,
      };
    case "stopping":
      return {
        canStart: false,
        canRestart: false,
        canRebuild: false,
        canStop: false,
        canReload: false,
      };
    case "errored":
      return {
        canStart: true,
        canRestart: true,
        canRebuild: true,
        // A failed stop can leave a cloud sandbox/process registered. Since
        // errored state does not retain failure provenance, keep cancellation
        // available conservatively; stopping an absent process is idempotent.
        canStop: true,
        canReload: false,
      };
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected app-run state: ${JSON.stringify(value)}`);
}
