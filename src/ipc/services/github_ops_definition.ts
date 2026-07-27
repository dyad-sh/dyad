import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps } from "@/db/schema";
import type {
  DistributedMachineDefinition,
  MachineHostContext,
} from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { ignore } from "@/state_machines/types";
import type { GithubOpsCommand } from "@/github_ops/state";
import { INITIAL_GITHUB_OPS_STATE } from "@/github_ops/state";
import { transition } from "@/github_ops/transition";
import {
  GITHUB_OPS_INVOCATION_KIND,
  GITHUB_OPS_MACHINE_ID,
  GithubOpsIntentEventSchema,
  GithubOpsKeySchema,
  GithubOpsRemoteSnapshotSchema,
  githubOpsKey,
  githubOpsFailureKind,
  isGithubOpsStateSensitiveIntent,
  projectGithubOpsRemoteSnapshot,
  toGithubOpsDomainEvent,
  type GithubOpsActorState,
  type GithubOpsIntentEvent,
  type GithubOpsInvocationRef,
  type GithubOpsKey,
  type GithubOpsProducerEvent,
  type GithubOpsWireEvent,
} from "@/github_ops/transport";
import { githubOpsService } from "./github_ops_service";

type GithubOpsActorCommand = {
  readonly type: "domain";
  readonly command: GithubOpsCommand;
  readonly invocationRef: GithubOpsInvocationRef | null;
};

function sameInvocation(
  left: GithubOpsInvocationRef | null,
  right: GithubOpsInvocationRef,
): boolean {
  return (
    left?.kind === right.kind &&
    left.entityKey === right.entityKey &&
    left.operationId === right.operationId
  );
}

function invocation(
  appId: number,
  operationId: string,
): GithubOpsInvocationRef {
  return {
    kind: GITHUB_OPS_INVOCATION_KIND,
    entityKey: appId,
    operationId,
  };
}

function transitionActor(
  key: GithubOpsKey,
  actorState: GithubOpsActorState,
  event: GithubOpsWireEvent,
) {
  if (
    (event.type === "OP_SUCCEEDED" || event.type === "OP_FAILED") &&
    !sameInvocation(actorState.activeInvocationRef, event.invocationRef)
  ) {
    return ignore(actorState, "stale-operation");
  }
  if (
    event.type === "OP_REQUESTED" &&
    event.activeInvocationRef &&
    event.activeInvocationRef.entityKey !== key.appId
  ) {
    return ignore(actorState, "stale-operation");
  }
  if (
    event.type === "RESOLVE_WITH_AI_STARTED" &&
    actorState.conflictResolutionPending
  ) {
    return ignore(actorState, "invalid-in-current-state");
  }
  if (
    event.type === "CONFLICT_RESOLUTION_CANCELLED" &&
    !actorState.conflictResolutionPending
  ) {
    return ignore(actorState, "invalid-in-current-state");
  }

  const result = transition(actorState.state, toGithubOpsDomainEvent(event));
  if (result.kind === "ignored") return { ...result, state: actorState };

  let activeInvocationRef = actorState.activeInvocationRef;
  if (event.type === "OP_REQUESTED" && result.state.type === "running") {
    activeInvocationRef = invocation(key.appId, event.operationId);
  } else if (
    event.type === "ABORT_AND_SWITCH_CONFIRMED" &&
    result.state.type === "running"
  ) {
    activeInvocationRef = invocation(key.appId, event.operationId);
  } else if (
    activeInvocationRef === null &&
    result.state.type !== "idle" &&
    (event.type === "GIT_STATE" || event.type === "CONFLICTS") &&
    event.recoveryInvocationRef
  ) {
    activeInvocationRef = event.recoveryInvocationRef;
  } else if (result.state.type === "idle") {
    activeInvocationRef = null;
  }
  const conflictResolutionPending =
    event.type === "RESOLVE_WITH_AI_STARTED"
      ? true
      : event.type === "CONFLICT_RESOLUTION_STARTED" ||
          event.type === "CONFLICT_RESOLUTION_CANCELLED" ||
          event.type === "RECONCILE_REQUESTED" ||
          result.state.type !== "conflicted"
        ? false
        : actorState.conflictResolutionPending;

  const state =
    result.state === actorState.state &&
    activeInvocationRef === actorState.activeInvocationRef &&
    conflictResolutionPending === actorState.conflictResolutionPending
      ? actorState
      : {
          state: result.state,
          activeInvocationRef,
          conflictResolutionPending,
        };
  return {
    kind: "applied" as const,
    state,
    commands: result.commands.map((command) => ({
      type: "domain" as const,
      command,
      invocationRef: activeInvocationRef,
    })),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createCommandRunner(
  context: MachineHostContext<
    GithubOpsKey,
    GithubOpsActorState,
    GithubOpsWireEvent
  >,
) {
  let gitStateProbeGeneration = 0;
  let conflictProbeGeneration = 0;
  const emit = (event: GithubOpsProducerEvent) => context.send(event);

  return ({ command, invocationRef }: GithubOpsActorCommand): void => {
    const appId = context.key.appId;
    switch (command.type) {
      case "run-op": {
        if (!invocationRef) return;
        gitStateProbeGeneration += 1;
        conflictProbeGeneration += 1;
        void githubOpsService.run(appId, command.op).then(
          () =>
            emit({
              type: "OP_SUCCEEDED",
              op: command.op,
              invocationRef,
            }),
          (error) =>
            emit({
              type: "OP_FAILED",
              op: command.op,
              invocationRef,
              failure: {
                ...((error as { code?: unknown })?.code &&
                typeof (error as { code?: unknown }).code === "string"
                  ? { code: (error as { code: string }).code }
                  : {}),
                kind: githubOpsFailureKind(error),
                message: errorMessage(error, "GitHub operation failed"),
              },
            }),
        );
        return;
      }
      case "probe-git-state": {
        const generation = ++gitStateProbeGeneration;
        const recoveryInvocationRef =
          invocationRef ??
          invocation(
            appId,
            context.ids.next(`${GITHUB_OPS_INVOCATION_KIND}:recovery`),
          );
        void githubOpsService.getGitState(appId).then(
          (state) => {
            if (generation === gitStateProbeGeneration) {
              emit({ type: "GIT_STATE", ...state, recoveryInvocationRef });
            }
          },
          () => undefined,
        );
        return;
      }
      case "probe-conflicts": {
        const generation = ++conflictProbeGeneration;
        const recoveryInvocationRef =
          invocationRef ??
          invocation(
            appId,
            context.ids.next(`${GITHUB_OPS_INVOCATION_KIND}:recovery`),
          );
        void githubOpsService.getConflicts(appId).then(
          (files) => {
            if (generation === conflictProbeGeneration) {
              emit({ type: "CONFLICTS", files, recoveryInvocationRef });
            }
          },
          () => {
            if (
              generation === conflictProbeGeneration &&
              command.settleOnError
            ) {
              emit({ type: "CONFLICTS", files: [] });
            }
          },
        );
        return;
      }
      case "invalidate-branches":
        queryInvalidationBus.publish([
          { family: "branches", appId },
          { family: "versions", appId },
        ]);
        return;
      case "refresh-app":
        queryInvalidationBus.publish([
          { family: "app", appId },
          { family: "apps" },
        ]);
        return;
      case "notify":
        // The authoritative banner is part of the remote snapshot. Avoid
        // duplicating a window-specific toast from main.
        return;
      case "start-conflict-resolution":
        // Renderer presentation starts only after the applied dispatch receipt.
        return;
    }
  };
}

async function appExists(appId: number): Promise<boolean> {
  const app = await db.query.apps.findFirst({
    columns: { id: true },
    where: eq(apps.id, appId),
  });
  return !!app;
}

async function authorizeApp(appId: number): Promise<void> {
  if (appId === 0) return;
  if (!(await appExists(appId))) {
    throw new DyadError("App not found", DyadErrorKind.Auth);
  }
}

type GithubOpsDefinition = DistributedMachineDefinition<
  typeof GITHUB_OPS_MACHINE_ID,
  GithubOpsKey,
  GithubOpsActorState,
  GithubOpsWireEvent,
  GithubOpsActorCommand,
  import("@/github_ops/state").GithubOpsIgnoreReason | "stale-operation"
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      typeof GITHUB_OPS_MACHINE_ID,
      GithubOpsKey,
      GithubOpsActorState,
      GithubOpsWireEvent,
      GithubOpsActorCommand,
      import("@/github_ops/state").GithubOpsIgnoreReason | "stale-operation"
    >["remote"]
  >;
};

export const githubOpsDefinition: GithubOpsDefinition = {
  id: GITHUB_OPS_MACHINE_ID,
  host: "main",
  initialState: (): GithubOpsActorState => ({
    state: INITIAL_GITHUB_OPS_STATE,
    activeInvocationRef: null,
    conflictResolutionPending: false,
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
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: GithubOpsKeySchema,
    encodeKey: (key) => key,
    canonicalizeKeyAfterAuthorization: (key) => githubOpsKey(key.appId),
    eventCodec: GithubOpsIntentEventSchema as z.ZodType<GithubOpsWireEvent>,
    snapshotCodec: GithubOpsRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    projectSnapshot: (state, key, metadata) =>
      projectGithubOpsRemoteSnapshot(
        key.appId,
        metadata.snapshotRevision,
        state,
      ),
    unavailableSnapshot: (key) =>
      projectGithubOpsRemoteSnapshot(key.appId, 0, {
        state: INITIAL_GITHUB_OPS_STATE,
        activeInvocationRef: null,
        conflictResolutionPending: false,
      }),
    revisionPolicy: (event) =>
      isGithubOpsStateSensitiveIntent(event as GithubOpsIntentEvent)
        ? "reject-stale"
        : "allow-stale",
    authorizeSubscribe: ({ key }) => authorizeApp(key.appId),
    authorizeDispatch: async ({ key, event, currentState }) => {
      await authorizeApp(key.appId);
      if (
        event.type === "OP_REQUESTED" &&
        (event.op.type === "rebase-abort" || event.op.type === "merge-abort") &&
        !sameInvocation(
          currentState?.activeInvocationRef ?? null,
          event.activeInvocationRef ??
            ({
              kind: GITHUB_OPS_INVOCATION_KIND,
              entityKey: key.appId,
              operationId: "",
            } as GithubOpsInvocationRef),
        )
      ) {
        throw new DyadError(
          "Cancellation does not target the active Git operation",
          DyadErrorKind.Auth,
        );
      }
    },
  },
};
