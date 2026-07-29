import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps } from "@/db/schema";
import type {
  DistributedMachineDefinition,
  MachineHostContext,
} from "@/distributed_machines/definition";
import { defineFrameworkCoveredRemoteMachine } from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { ignore } from "@/state_machines/types";
import type {
  GithubOpsCommand,
  GithubOpsCorrelatedOutcome,
} from "@/github_ops/state";
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
import { githubOpsRemoteIntentContract } from "@/github_ops/remote_intent_contract";
import { githubOpsService } from "./github_ops_service";
import { safeGithubOpsErrorMessage } from "./github_ops_safe_error";
import { githubOpsOperationService } from "./github_ops_operation_service";
import { githubOpsPresentationService } from "./github_ops_presentation_service";

type GithubOpsActorCommand =
  | {
      readonly type: "domain";
      readonly command: GithubOpsCommand;
      readonly invocationRef: GithubOpsInvocationRef | null;
    }
  | {
      readonly type: "schedule-conflict-claim-expiry";
      readonly claimId: string;
    };

export const CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS = 30_000;
const CONFLICT_RESOLUTION_CLAIM_TIMER = "conflict-resolution-claim";

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
): import("@/state_machines/types").TransitionResult<
  GithubOpsActorState,
  GithubOpsActorCommand,
  import("@/github_ops/state").GithubOpsIgnoreReason | "stale-operation",
  GithubOpsCorrelatedOutcome
> {
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
    actorState.conflictResolutionClaimId !== null
  ) {
    return ignore(actorState, "invalid-in-current-state");
  }
  if (
    (event.type === "CONFLICT_RESOLUTION_STARTED" ||
      event.type === "CONFLICT_RESOLUTION_CANCELLED" ||
      event.type === "CONFLICT_RESOLUTION_CLAIM_EXPIRED") &&
    actorState.conflictResolutionClaimId !== event.claimId
  ) {
    return ignore(actorState, "stale-operation");
  }
  if (event.type === "CONFLICT_RESOLUTION_CLAIM_EXPIRED") {
    return {
      kind: "applied" as const,
      state: {
        ...actorState,
        conflictResolutionClaimId: null,
      },
      commands: [],
    };
  }

  const result = transition(actorState.state, toGithubOpsDomainEvent(event));
  if (result.kind === "ignored") return { ...result, state: actorState };

  const previousInvocationRef = actorState.activeInvocationRef;
  const previousRequestId = actorState.activeRequestId;
  let activeInvocationRef = actorState.activeInvocationRef;
  let activeRequestId = actorState.activeRequestId;
  if (event.type === "OP_REQUESTED" && result.state.type === "running") {
    activeInvocationRef = invocation(key.appId, event.operationId);
    activeRequestId = event.requestId;
  } else if (
    event.type === "ABORT_AND_SWITCH_CONFIRMED" &&
    result.state.type === "running"
  ) {
    activeInvocationRef = invocation(key.appId, event.operationId);
    activeRequestId = event.requestId;
  } else if (
    activeInvocationRef === null &&
    result.state.type !== "idle" &&
    (event.type === "GIT_STATE" || event.type === "CONFLICTS") &&
    event.recoveryInvocationRef
  ) {
    activeInvocationRef = event.recoveryInvocationRef;
  } else if (result.state.type === "idle") {
    activeInvocationRef = null;
    activeRequestId = null;
  } else if (event.type === "OP_FAILED") {
    activeRequestId = null;
  }
  const conflictResolutionClaimId =
    event.type === "RESOLVE_WITH_AI_STARTED"
      ? event.claimId
      : event.type === "CONFLICT_RESOLUTION_STARTED" ||
          event.type === "CONFLICT_RESOLUTION_CANCELLED" ||
          result.state.type !== "conflicted"
        ? null
        : actorState.conflictResolutionClaimId;

  const state =
    result.state === actorState.state &&
    activeInvocationRef === actorState.activeInvocationRef &&
    activeRequestId === actorState.activeRequestId &&
    conflictResolutionClaimId === actorState.conflictResolutionClaimId
      ? actorState
      : {
          state: result.state,
          activeInvocationRef,
          activeRequestId,
          conflictResolutionClaimId,
        };
  const outcomes: GithubOpsCorrelatedOutcome[] =
    previousRequestId && previousInvocationRef
      ? event.type === "OP_FAILED"
        ? [
            {
              requestId: previousRequestId,
              invocationRef: previousInvocationRef,
              outcome: {
                kind: "failed",
                operation: event.op.type,
                failure: event.failure,
              },
            },
          ]
        : event.type === "OP_SUCCEEDED" && result.state.type === "idle"
          ? [
              {
                requestId: previousRequestId,
                invocationRef: previousInvocationRef,
                outcome: {
                  kind: "succeeded",
                  operation: event.op.type,
                },
              },
            ]
          : []
      : [];
  return {
    kind: "applied" as const,
    state,
    commands: [
      ...(event.type === "OP_REQUESTED" ||
      event.type === "ABORT_AND_SWITCH_CONFIRMED"
        ? [
            {
              type: "domain" as const,
              command: {
                type: "record-operation-route" as const,
                operationId: event.operationId,
                windowSessionId: event.initiatorWindowSessionId,
              },
              invocationRef: activeInvocationRef,
            },
          ]
        : []),
      ...result.commands.map((command) => ({
        type: "domain" as const,
        command,
        invocationRef: activeInvocationRef ?? previousInvocationRef,
      })),
      ...(event.type === "RESOLVE_WITH_AI_STARTED"
        ? [
            {
              type: "schedule-conflict-claim-expiry" as const,
              claimId: event.claimId,
            },
          ]
        : []),
    ],
    ...(outcomes.length > 0 ? { outcomes } : {}),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return safeGithubOpsErrorMessage(error, fallback);
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
  const producerSink = context.captureSink({ revisionPolicy: "allow-advance" });
  const emit = (event: GithubOpsProducerEvent) => producerSink.send(event);

  return (actorCommand: GithubOpsActorCommand): Promise<void> => {
    if (actorCommand.type === "schedule-conflict-claim-expiry") {
      context.timers.replace(
        CONFLICT_RESOLUTION_CLAIM_TIMER,
        actorCommand.claimId,
        CONFLICT_RESOLUTION_CLAIM_TIMEOUT_MS,
        (claimId) => ({
          type: "CONFLICT_RESOLUTION_CLAIM_EXPIRED",
          claimId: String(claimId),
        }),
        context.send,
      );
      return Promise.resolve();
    }
    const { command, invocationRef } = actorCommand;
    const appId = context.key.appId;
    switch (command.type) {
      case "run-op": {
        if (!invocationRef) return Promise.resolve();
        gitStateProbeGeneration += 1;
        conflictProbeGeneration += 1;
        return githubOpsService.run(appId, command.op).then(
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
      }
      case "probe-git-state": {
        const generation = ++gitStateProbeGeneration;
        const recoveryInvocationRef =
          invocationRef ??
          invocation(
            appId,
            context.ids.next(`${GITHUB_OPS_INVOCATION_KIND}:recovery`),
          );
        return githubOpsService.getGitState(appId).then(
          (state) => {
            if (generation === gitStateProbeGeneration) {
              emit({ type: "GIT_STATE", ...state, recoveryInvocationRef });
            }
          },
          () => {
            if (generation !== gitStateProbeGeneration) return;
            githubOpsPresentationService.showError(
              appId,
              invocationRef?.operationId,
              "Could not refresh the repository state",
            );
          },
        );
      }
      case "probe-conflicts": {
        const generation = ++conflictProbeGeneration;
        const recoveryInvocationRef =
          invocationRef ??
          invocation(
            appId,
            context.ids.next(`${GITHUB_OPS_INVOCATION_KIND}:recovery`),
          );
        return githubOpsService.getConflicts(appId).then(
          (files) => {
            if (generation === conflictProbeGeneration) {
              emit({ type: "CONFLICTS", files, recoveryInvocationRef });
            }
          },
          () => {
            if (generation !== conflictProbeGeneration) return;
            githubOpsPresentationService.showError(
              appId,
              invocationRef?.operationId,
              "Could not check the repository for merge conflicts",
            );
            if (command.settleOnError) {
              emit({ type: "CONFLICTS", files: [] });
            }
          },
        );
      }
      case "invalidate-branches":
        queryInvalidationBus.publish([
          { family: "branches", appId },
          { family: "versions", appId },
        ]);
        return Promise.resolve();
      case "refresh-app":
        queryInvalidationBus.publish([
          { family: "app", appId },
          { family: "apps" },
        ]);
        return Promise.resolve();
      case "notify":
        if (command.kind === "error") {
          githubOpsPresentationService.showError(
            appId,
            invocationRef?.operationId,
            command.message,
          );
        }
        return Promise.resolve();
      case "record-operation-route":
        githubOpsPresentationService.recordInitiator(
          command.operationId,
          context.actorInstanceId,
          appId,
          command.windowSessionId,
        );
        return Promise.resolve();
      case "start-conflict-resolution":
        // Renderer presentation starts only after the applied dispatch receipt.
        return Promise.resolve();
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
  import("@/github_ops/state").GithubOpsIgnoreReason | "stale-operation",
  GithubOpsIntentEvent,
  GithubOpsCorrelatedOutcome
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      typeof GITHUB_OPS_MACHINE_ID,
      GithubOpsKey,
      GithubOpsActorState,
      GithubOpsWireEvent,
      GithubOpsActorCommand,
      import("@/github_ops/state").GithubOpsIgnoreReason | "stale-operation",
      GithubOpsIntentEvent,
      GithubOpsCorrelatedOutcome
    >["remote"]
  >;
};

export const githubOpsDefinition = defineFrameworkCoveredRemoteMachine({
  id: GITHUB_OPS_MACHINE_ID,
  host: "main",
  initialState: (): GithubOpsActorState => ({
    state: INITIAL_GITHUB_OPS_STATE,
    activeInvocationRef: null,
    activeRequestId: null,
    conflictResolutionClaimId: null,
  }),
  transition: (state, event, key) => transitionActor(key, state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) void execute(command);
    },
  }),
  commandSinkRevisionPolicy: "allow-advance",
  createCommandRunner,
  createOutcomePublisher: (context) =>
    githubOpsOperationService.createPublisher(context.getMetadata),
  createBeforeCommit: (context) => (previous, next) => {
    if (
      previous.conflictResolutionClaimId !== null &&
      previous.conflictResolutionClaimId !== next.conflictResolutionClaimId
    ) {
      context.timers.remove(CONFLICT_RESOLUTION_CLAIM_TIMER);
    }
  },
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
    flush: () => Promise.resolve(),
    settleWaiters: ({ metadata }) => {
      githubOpsOperationService.settleActor(metadata.actorInstanceId);
    },
    onDisposed: ({ metadata }) => {
      githubOpsOperationService.releaseActor(metadata.actorInstanceId);
    },
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
        activeRequestId: null,
        conflictResolutionClaimId: null,
      }),
    revisionPolicy: (event) =>
      isGithubOpsStateSensitiveIntent(event as GithubOpsIntentEvent)
        ? "reject-stale"
        : "allow-stale",
    authorizeSubscribe: ({ key }) => authorizeApp(key.appId),
    authorizeDispatch: async ({ key, event, currentState }) => {
      if (key.appId === 0) {
        throw new DyadError(
          "A real app is required for GitHub operations",
          DyadErrorKind.Auth,
        );
      }
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
  remoteIntentDeclaration: githubOpsRemoteIntentContract,
  remoteIntentAdapter: "protocol-v1",
  remoteOperation: githubOpsOperationService.remoteContract(),
} satisfies GithubOpsDefinition);
