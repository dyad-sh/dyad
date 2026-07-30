import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps } from "@/db/schema";
import type {
  DistributedMachineDefinition,
  MachineHostContext,
} from "@/distributed_machines/definition";
import { defineFrameworkCoveredRemoteMachine } from "@/distributed_machines/definition";
import {
  createOperationOutcomePublisher,
  finalizeOperationAdmission,
  type OperationOwner,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";
import { defineRuntimeRemoteIntentContract } from "@/distributed_machines/remote_intent_contract";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { ignore } from "@/state_machines/types";
import { sameInvocationRef } from "@/state_machines/invocation_ref";
import {
  CLOSED_STATE,
  type PreviewCommand,
  type PreviewState,
  type RestoreRecovery,
} from "@/version_preview/state";
import { transition } from "@/version_preview/transition";
import {
  VERSION_PREVIEW_INVOCATION_KIND,
  VERSION_PREVIEW_MACHINE_ID,
  VersionPreviewIntentEventSchema,
  VersionPreviewKeySchema,
  VersionPreviewRemoteSnapshotSchema,
  projectVersionPreviewRemoteSnapshot,
  toPreviewDomainEvent,
  versionPreviewKey,
  type VersionPreviewActorState,
  type VersionPreviewActorEvent,
  type VersionPreviewAdmittedIntent,
  type VersionPreviewCorrelatedProducerEvent,
  type VersionPreviewIntentEvent,
  type VersionPreviewInvocationRef,
  type VersionPreviewKey,
  type VersionPreviewProducerEvent,
  type VersionPreviewWireEvent,
} from "@/version_preview/transport";
import {
  VersionPreviewEnqueueError,
  versionPreviewOperationKind,
  versionPreviewOperationRegistry,
  type VersionPreviewCorrelatedOutcome,
  type VersionPreviewOperationKind,
} from "@/version_preview/operations";
import { versionPreviewRemoteIntentContract } from "@/version_preview/remote_intent_contract";
import { appRunActorService } from "./app_run_actor_service";
import { versionPreviewPresentationService } from "./version_preview_presentation_service";
import { versionPreviewService } from "./version_preview_service";
import { versionPreviewPersistence } from "./version_preview_persistence";

interface VersionPreviewActorCommand {
  readonly command: PreviewCommand | { readonly type: "reconcile" };
  readonly invocationRef: VersionPreviewInvocationRef | null;
  readonly requestId?: RequestId;
  readonly operation?: VersionPreviewOperationKind;
}

function invocation(
  appId: number,
  operationId: string,
): VersionPreviewInvocationRef {
  return {
    kind: VERSION_PREVIEW_INVOCATION_KIND,
    entityKey: appId,
    operationId,
  };
}

function sameInvocation(
  active: VersionPreviewInvocationRef | null,
  event: VersionPreviewActorEvent,
): boolean {
  if (event.type === "RECONCILE_REQUESTED" || event.type === "RECONCILED") {
    return true;
  }
  return (
    "invocationRef" in event &&
    active?.kind === event.invocationRef.kind &&
    active.entityKey === event.invocationRef.entityKey &&
    active.operationId === event.invocationRef.operationId
  );
}

function isIntent(
  event: VersionPreviewActorEvent,
): event is VersionPreviewAdmittedIntent {
  return "operationId" in event && "windowSessionId" in event;
}

function isMutationCommand(command: PreviewCommand): boolean {
  return (
    command.type === "checkout" ||
    command.type === "return" ||
    command.type === "switch-branch" ||
    command.type === "restore" ||
    command.type === "restore-to-message"
  );
}

function isFailureEvent(event: VersionPreviewActorEvent): boolean {
  return (
    event.type === "ORIGIN_RESOLUTION_FAILED" ||
    event.type === "CHECKOUT_FAILED" ||
    event.type === "RESTORE_FAILED" ||
    event.type === "RESTORE_RECOVERY_REQUIRED" ||
    event.type === "RETURN_FAILED" ||
    event.type === "SWITCH_BRANCH_FAILED"
  );
}

function producerError(
  event: VersionPreviewCorrelatedProducerEvent,
): { message: string } | undefined {
  return "error" in event ? event.error : undefined;
}

function producerOperationKind(
  event: VersionPreviewCorrelatedProducerEvent,
): VersionPreviewOperationKind | undefined {
  if (event.operation) return event.operation;
  switch (event.type) {
    case "ORIGIN_RESOLVED":
    case "ORIGIN_RESOLUTION_FAILED":
    case "CHECKOUT_SUCCEEDED":
    case "CHECKOUT_FAILED":
      return "select-version";
    case "RESTORE_SUCCEEDED":
    case "RESTORE_FAILED":
    case "RESTORE_RECOVERY_REQUIRED":
      return "restore";
    case "RETURN_SUCCEEDED":
    case "RETURN_FAILED":
      return "close";
    case "SWITCH_BRANCH_SUCCEEDED":
    case "SWITCH_BRANCH_FAILED":
      return "switch-branch";
    case "RECONCILE_REQUESTED":
    case "RECONCILED":
      return undefined;
  }
}

function reconcileRestore(
  current: Extract<
    PreviewState,
    { type: "restoring" | "restore-recovery-required" }
  >,
  event: Extract<VersionPreviewWireEvent, { type: "RECONCILED" }>,
): PreviewState {
  const recovery = current.restoreRecovery;

  if (
    current.type === "restoring" &&
    recovery?.nextStep === "completed" &&
    recovery.repositoryOutcome === "unchanged"
  ) {
    const session = {
      ...current.session,
      targetVersionId: current.session.checkedOutVersionId,
      selectedDiffFile: null,
      isDiffVisible: false,
    };
    if (current.fallback === "closed") return CLOSED_STATE;
    return { type: current.fallback, session };
  }

  if (recovery && "preRestoreHead" in recovery) {
    const branchMatches =
      recovery.preRestoreBranch !== null &&
      event.branch === recovery.preRestoreBranch;
    const preRestoreStateMatches =
      branchMatches &&
      event.headOid === recovery.preRestoreHead &&
      event.isClean;
    const maySettleAtPreRestoreState =
      recovery.nextStep !== "chat-mutation" &&
      recovery.nextStep !== "completed";
    const completedStateMatches =
      recovery.nextStep === "completed" &&
      recovery.repositoryOutcome === "target-applied" &&
      branchMatches &&
      event.headOid === recovery.completedHead &&
      event.isClean;
    if (
      (maySettleAtPreRestoreState && preRestoreStateMatches) ||
      completedStateMatches
    ) {
      return CLOSED_STATE;
    }
  }

  return {
    type: "restore-recovery-required",
    session: current.session,
    error: {
      message:
        "Dyad restarted during an interrupted version restore. Inspect and repair the repository before continuing.",
    },
    restoreRecovery: recovery,
  };
}

function transitionActor(
  key: VersionPreviewKey,
  actorState: VersionPreviewActorState,
  event: VersionPreviewActorEvent,
) {
  const interests = actorState.windowInterestSessionIds ?? [];
  if (
    event.type === "WINDOW_INTEREST_DISPOSED" ||
    event.type === "RELEASE_WINDOW_INTEREST"
  ) {
    if (!interests.includes(event.windowSessionId)) {
      return ignore(actorState, "no-change");
    }
    return {
      kind: "applied" as const,
      state: {
        ...actorState,
        windowInterestSessionIds: interests.filter(
          (sessionId) => sessionId !== event.windowSessionId,
        ),
      },
      commands: [],
    };
  }
  if (
    event.type === "ACQUIRE_WINDOW_INTEREST" ||
    event.type === "RESTORE_WINDOW_INTEREST"
  ) {
    if (interests.includes(event.windowSessionId)) {
      return ignore(actorState, "interest-already-owned");
    }
    if (event.type === "RESTORE_WINDOW_INTEREST" && interests.length > 0) {
      return ignore(actorState, "interest-owned-by-another-window");
    }
    return {
      kind: "applied" as const,
      state: {
        ...actorState,
        windowInterestSessionIds: [...interests, event.windowSessionId],
      },
      commands: [],
    };
  }
  if (event.type === "RECONCILE_REQUESTED") {
    return {
      kind: "applied" as const,
      state: actorState,
      commands: [
        {
          command: { type: "reconcile" as const },
          invocationRef: null,
        },
      ],
    };
  }
  if (event.type === "RECONCILED") {
    const current = actorState.state;
    if (
      current.type === "closed" ||
      current.type === "viewing-diff" ||
      current.type === "browsing" ||
      current.type === "resolving-origin"
    ) {
      return ignore(actorState, "no-change");
    }
    let state: import("@/version_preview/state").PreviewState;
    if (current.type === "switching-branch") {
      const fallback = current.fallback;
      const ownsCheckout =
        fallback.type === "previewing" || fallback.type === "recovery-required";
      const reachedSafeBranch =
        event.branch === current.branch ||
        (ownsCheckout && event.branch === fallback.session.originBranch);
      state =
        !ownsCheckout || reachedSafeBranch
          ? CLOSED_STATE
          : {
              type: "recovery-required",
              session: fallback.session,
              error: {
                message:
                  "Dyad restarted while switching branches. Return to the original branch before continuing.",
              },
            };
    } else if (
      current.type === "restoring" ||
      current.type === "restore-recovery-required"
    ) {
      state = reconcileRestore(current, event);
    } else {
      state =
        event.branch === current.session.originBranch
          ? CLOSED_STATE
          : {
              type: "recovery-required",
              session: current.session,
              error: {
                message:
                  "Dyad restarted during a version checkout. Return to the original branch before continuing.",
              },
            };
    }
    return {
      kind: "applied" as const,
      state: {
        state,
        activeInvocationRef: null,
        lastSettlement: actorState.lastSettlement,
        windowInterestSessionIds: interests,
      },
      commands: [],
    };
  }
  if (
    !isIntent(event) &&
    !sameInvocation(actorState.activeInvocationRef, event)
  ) {
    return ignore(actorState, "stale-operation");
  }

  let domainState = actorState.state;
  const operation = isIntent(event)
    ? versionPreviewOperationKind(event)
    : producerOperationKind(event);
  const requestId = "requestId" in event ? event.requestId : undefined;
  let nextInterests = interests;
  let cleanupStarted: boolean | undefined;
  if (
    isIntent(event) &&
    (event.type === "CLOSE" || event.type === "APP_CHANGED")
  ) {
    const exitOperation: VersionPreviewOperationKind =
      event.type === "CLOSE" ? "close" : "switch-app";
    const destructiveCleanup = event.windowSessionId === "main-deletion";
    if (
      !destructiveCleanup &&
      interests.length > 0 &&
      !interests.includes(event.windowSessionId)
    ) {
      const immediate = {
        operationId: event.operationId,
        requestId,
        operation: exitOperation,
        outcome: "succeeded" as const,
        cleanupStarted: false,
      };
      const outcomes =
        requestId === undefined
          ? undefined
          : ([
              {
                requestId,
                invocationRef: invocation(key.appId, event.operationId),
                outcome: {
                  kind: "succeeded" as const,
                  operation: exitOperation,
                  cleanupStarted: false,
                },
              },
            ] satisfies VersionPreviewCorrelatedOutcome[]);
      return {
        kind: "applied" as const,
        state: { ...actorState, lastSettlement: immediate },
        commands: [],
        ...(outcomes ? { outcomes } : {}),
      };
    }
    nextInterests = destructiveCleanup
      ? []
      : interests.filter((sessionId) => sessionId !== event.windowSessionId);
    if (nextInterests.length > 0) {
      const immediate = {
        operationId: event.operationId,
        requestId,
        operation: exitOperation,
        outcome: "succeeded" as const,
        cleanupStarted: false,
      };
      const outcomes =
        requestId === undefined
          ? undefined
          : ([
              {
                requestId,
                invocationRef: invocation(key.appId, event.operationId),
                outcome: {
                  kind: "succeeded" as const,
                  operation: exitOperation,
                  cleanupStarted: false,
                },
              },
            ] satisfies VersionPreviewCorrelatedOutcome[]);
      return {
        kind: "applied" as const,
        state: {
          ...actorState,
          windowInterestSessionIds: nextInterests,
          lastSettlement: immediate,
        },
        commands: [],
        ...(outcomes ? { outcomes } : {}),
      };
    }
    if (
      domainState.type === "closed" ||
      domainState.type === "returning" ||
      domainState.type === "switching-branch"
    ) {
      const immediate = {
        operationId: event.operationId,
        requestId,
        operation: exitOperation,
        outcome: "succeeded" as const,
        cleanupStarted: false,
      };
      const outcomes =
        requestId === undefined
          ? undefined
          : ([
              {
                requestId,
                invocationRef: invocation(key.appId, event.operationId),
                outcome: {
                  kind: "succeeded" as const,
                  operation: exitOperation,
                  cleanupStarted: false,
                },
              },
            ] satisfies VersionPreviewCorrelatedOutcome[]);
      return {
        kind: "applied" as const,
        state: {
          ...actorState,
          windowInterestSessionIds: nextInterests,
          lastSettlement: immediate,
        },
        commands: [],
        ...(outcomes ? { outcomes } : {}),
      };
    }
    cleanupStarted = true;
  }
  // Pane visibility is window-local. A checkout intent carries enough meaning
  // to establish the browsing precondition without remotely opening the pane.
  if (
    event.type === "SELECT_VERSION" &&
    (domainState.type === "closed" || domainState.type === "viewing-diff")
  ) {
    const opened = transition(domainState, { type: "OPEN", appId: key.appId });
    if (opened.kind === "applied") domainState = opened.state;
  }
  const result = transition(
    domainState,
    toPreviewDomainEvent(key.appId, event),
  );
  if (result.kind === "ignored") return { ...result, state: actorState };

  const hasFollowup =
    result.commands.some(isMutationCommand) ||
    result.commands.some((command) => command.type === "resolve-origin");
  const currentRef = isIntent(event)
    ? hasFollowup || actorState.activeInvocationRef === null
      ? invocation(key.appId, event.operationId)
      : actorState.activeInvocationRef
    : actorState.activeInvocationRef;
  const completedProducer = !isIntent(event) && !hasFollowup && !!operation;
  const completedIntent = isIntent(event) && !hasFollowup;
  const terminal = completedProducer || completedIntent;
  const terminalInvocationRef = isIntent(event)
    ? invocation(key.appId, event.operationId)
    : event.invocationRef;
  const lastSettlement =
    terminal && operation && terminalInvocationRef
      ? {
          operationId: terminalInvocationRef.operationId,
          requestId,
          operation,
          outcome:
            !isIntent(event) && isFailureEvent(event)
              ? ("failed" as const)
              : ("succeeded" as const),
          ...(cleanupStarted === undefined ? {} : { cleanupStarted }),
          ...(!isIntent(event) && producerError(event)
            ? { error: producerError(event) }
            : {}),
        }
      : actorState.lastSettlement;
  const activeInvocationRef = hasFollowup
    ? currentRef
    : isIntent(event)
      ? result.state.type === "closed"
        ? null
        : actorState.activeInvocationRef
      : null;

  const correlatedOutcomes =
    terminal && requestId && operation && terminalInvocationRef
      ? ([
          {
            requestId,
            invocationRef: terminalInvocationRef,
            outcome:
              !isIntent(event) && isFailureEvent(event)
                ? {
                    kind: "failed" as const,
                    operation,
                    error: producerError(event) ?? {
                      message: "Version operation failed",
                    },
                  }
                : {
                    kind: "succeeded" as const,
                    operation,
                    ...(cleanupStarted === undefined ? {} : { cleanupStarted }),
                  },
          },
        ] satisfies VersionPreviewCorrelatedOutcome[])
      : undefined;
  return {
    kind: "applied" as const,
    state: {
      state: result.state,
      activeInvocationRef,
      lastSettlement,
      windowInterestSessionIds:
        result.state.type === "closed" ? [] : nextInterests,
    },
    commands: result.commands.map((command) => ({
      command,
      invocationRef: currentRef,
      requestId,
      operation,
    })),
    ...(correlatedOutcomes ? { outcomes: correlatedOutcomes } : {}),
  };
}

function errorInfo(error: unknown): { message: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function createCommandRunner(
  context: MachineHostContext<
    VersionPreviewKey,
    VersionPreviewActorState,
    VersionPreviewActorEvent
  >,
) {
  let resolveEpoch = 0;
  const sink = context.captureSink({ revisionPolicy: "allow-advance" });

  return ({
    command,
    invocationRef,
    requestId,
    operation,
  }: VersionPreviewActorCommand): Promise<void> => {
    const appId = context.key.appId;
    const emit = (event: VersionPreviewProducerEvent): void =>
      sink.send({ ...event, requestId, operation });
    switch (command.type) {
      case "reconcile":
        return versionPreviewService
          .reconcile(appId)
          .then(
            ({ branch, headOid, isClean }) =>
              sink.send({ type: "RECONCILED", branch, headOid, isClean }),
            () =>
              sink.send({
                type: "RECONCILED",
                branch: null,
                headOid: null,
                isClean: false,
              }),
          )
          .finally(() => versionPreviewService.endReconciliation(appId));
      case "resolve-origin": {
        if (!invocationRef) return Promise.resolve();
        const epoch = ++resolveEpoch;
        return versionPreviewService.resolveOriginBranch(appId).then(
          ({ branch }) => {
            if (epoch !== resolveEpoch) return;
            emit(
              branch === null
                ? { type: "ORIGIN_RESOLUTION_FAILED", invocationRef }
                : { type: "ORIGIN_RESOLVED", branch, invocationRef },
            );
          },
          () => {
            if (epoch === resolveEpoch) {
              emit({ type: "ORIGIN_RESOLUTION_FAILED", invocationRef });
            }
          },
        );
      }
      case "checkout":
      case "return":
      case "switch-branch":
      case "restore":
      case "restore-to-message": {
        if (!invocationRef) return Promise.resolve();
        let restoreProgress: RestoreRecovery | null = null;
        const isRestore =
          command.type === "restore" || command.type === "restore-to-message";
        // Phase 3A deliberately preserves the historical persistence boundary:
        // non-restore operations use the existing checkpoint below and restore
        // progress is recorded by the existing effect callback. Phase 3B must
        // add framework-level checkpoint-before-effect acceptance, including
        // the first restore effect, without changing the protocol-v1 snapshot
        // or persisted recovery schema. Until then this is recoverable
        // best-effort ordering, not crash-safe exactly-once execution.
        try {
          if (!isRestore) {
            versionPreviewPersistence.checkpoint(
              appId,
              context.getSnapshot().state,
            );
          }
        } catch (error) {
          const info = errorInfo(error);
          versionPreviewPresentationService.publishError(
            appId,
            invocationRef.operationId,
            `The version operation was not started because its recovery checkpoint could not be saved: ${info.message}`,
          );
          switch (command.type) {
            case "checkout":
              emit({ type: "CHECKOUT_FAILED", error: info, invocationRef });
              break;
            case "return":
              emit({ type: "RETURN_FAILED", error: info, invocationRef });
              break;
            case "switch-branch":
              emit({
                type: "SWITCH_BRANCH_FAILED",
                error: info,
                invocationRef,
              });
              break;
            case "restore":
            case "restore-to-message":
              emit({ type: "RESTORE_FAILED", error: info, invocationRef });
              break;
          }
          return Promise.resolve();
        }
        const operation =
          command.type === "restore" || command.type === "restore-to-message"
            ? versionPreviewService.run(
                command,
                invocationRef.operationId,
                (progress) => {
                  versionPreviewPersistence.checkpointRestore(
                    appId,
                    context.getSnapshot().state,
                    progress,
                  );
                  restoreProgress = progress;
                },
              )
            : versionPreviewService.run(command, invocationRef.operationId);
        const lifecycle = operation.then(
          async (result) => {
            try {
              const scopes = [
                { family: "branches", appId },
                { family: "versions", appId },
                { family: "app", appId },
                { family: "problems", appId },
                ...(result.affectedChatId
                  ? ([
                      { family: "chat", chatId: result.affectedChatId },
                    ] as const)
                  : []),
                ...(result.createdChatId
                  ? ([{ family: "chats" }] as const)
                  : []),
              ] as const;
              queryInvalidationBus.publish(scopes, {
                originEndpoint:
                  versionPreviewPresentationService.originEndpointFor(
                    invocationRef.operationId,
                  ),
                originHandledScopes: scopes,
              });
              versionPreviewPresentationService.publishResult(
                appId,
                invocationRef.operationId,
                result,
              );
              if (result.runtimeAction === "restart") {
                try {
                  await appRunActorService.executeExternalLifecycle({
                    appId,
                    operation: "restart",
                  });
                } catch (error) {
                  versionPreviewPresentationService.publishError(
                    appId,
                    invocationRef.operationId,
                    `The version changed, but the app could not restart: ${errorInfo(error).message}`,
                  );
                }
              }
            } finally {
              switch (command.type) {
                case "checkout":
                  emit({ type: "CHECKOUT_SUCCEEDED", invocationRef });
                  break;
                case "return":
                  emit({ type: "RETURN_SUCCEEDED", invocationRef });
                  break;
                case "switch-branch":
                  emit({ type: "SWITCH_BRANCH_SUCCEEDED", invocationRef });
                  break;
                case "restore":
                case "restore-to-message":
                  emit({
                    type: "RESTORE_SUCCEEDED",
                    repositoryOutcome: result.repositoryOutcome,
                    invocationRef,
                  });
                  break;
              }
            }
          },
          (error) => {
            const info = errorInfo(error);
            try {
              versionPreviewPresentationService.publishError(
                appId,
                invocationRef.operationId,
                info.message,
              );
            } finally {
              switch (command.type) {
                case "checkout":
                  emit({
                    type: "CHECKOUT_FAILED",
                    error: info,
                    invocationRef,
                  });
                  break;
                case "return":
                  emit({ type: "RETURN_FAILED", error: info, invocationRef });
                  break;
                case "switch-branch":
                  emit({
                    type: "SWITCH_BRANCH_FAILED",
                    error: info,
                    invocationRef,
                  });
                  break;
                case "restore":
                case "restore-to-message":
                  emit(
                    restoreProgress &&
                      restoreProgress.nextStep !== "preparing" &&
                      restoreProgress.nextStep !== "completed"
                      ? {
                          type: "RESTORE_RECOVERY_REQUIRED",
                          error: info,
                          restoreRecovery: restoreProgress,
                          invocationRef,
                        }
                      : {
                          type: "RESTORE_FAILED",
                          error: info,
                          invocationRef,
                        },
                  );
                  break;
              }
            }
          },
        );
        return lifecycle.catch((error) => {
          versionPreviewPresentationService.publishError(
            appId,
            invocationRef.operationId,
            `Version preview completion failed: ${errorInfo(error).message}`,
          );
          throw error;
        });
      }
      case "notify-error":
        if (invocationRef) {
          versionPreviewPresentationService.publishError(
            appId,
            invocationRef.operationId,
            command.message,
          );
        }
        return Promise.resolve();
      case "notify-recovery":
      case "dismiss-recovery":
        // Recovery is a durable snapshot fact. Every subscribed renderer
        // derives the disabled controls/error surface from that projection.
        return Promise.resolve();
    }
  };
}

async function appExists(appId: number): Promise<boolean> {
  return !!(await db.query.apps.findFirst({
    columns: { id: true },
    where: eq(apps.id, appId),
  }));
}

async function authorizeApp(appId: number): Promise<void> {
  if (appId === 0) return;
  if (!(await appExists(appId))) {
    throw new DyadError("App not found", DyadErrorKind.Auth);
  }
}

type Definition = DistributedMachineDefinition<
  typeof VERSION_PREVIEW_MACHINE_ID,
  VersionPreviewKey,
  VersionPreviewActorState,
  VersionPreviewActorEvent,
  VersionPreviewActorCommand,
  | import("@/version_preview/transition").PreviewIgnoreReason
  | "stale-operation"
  | "interest-already-owned"
  | "interest-owned-by-another-window",
  VersionPreviewIntentEvent,
  VersionPreviewCorrelatedOutcome
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      typeof VERSION_PREVIEW_MACHINE_ID,
      VersionPreviewKey,
      VersionPreviewActorState,
      VersionPreviewActorEvent,
      VersionPreviewActorCommand,
      | import("@/version_preview/transition").PreviewIgnoreReason
      | "stale-operation"
      | "interest-already-owned"
      | "interest-owned-by-another-window",
      VersionPreviewIntentEvent,
      VersionPreviewCorrelatedOutcome
    >["remote"]
  >;
};

export const versionPreviewDefinition =
  defineFrameworkCoveredRemoteMachine<Definition>({
    id: VERSION_PREVIEW_MACHINE_ID,
    host: "main",
    initialState: (key) => ({
      state: versionPreviewPersistence.load(key.appId),
      activeInvocationRef: null,
      lastSettlement: null,
      windowInterestSessionIds: [],
    }),
    transition: (state, event, key) => transitionActor(key, state, event),
    createScheduler: () => ({
      schedule(batch, execute) {
        for (const command of batch.commands) void execute(command);
      },
    }),
    createCommandRunner: (context) => {
      const runner = createCommandRunner(context);
      if (context.getSnapshot().state.type !== "closed") {
        versionPreviewService.beginReconciliation(context.key.appId);
        queueMicrotask(() => context.send({ type: "RECONCILE_REQUESTED" }));
      }
      return runner;
    },
    createObserver: (context) => ({
      onTransitionApplied: ({ previous, state }) => {
        versionPreviewPersistence.schedule(context.key.appId, state.state);
        if (
          state.lastSettlement &&
          state.lastSettlement.requestId === undefined &&
          state.lastSettlement !== previous.lastSettlement
        ) {
          versionPreviewPresentationService.settle(
            state.lastSettlement.operationId,
          );
        }
        const previousOperationId =
          previous.activeInvocationRef?.operationId ?? null;
        if (
          previous.activeInvocationRef &&
          previous.activeInvocationRef.operationId !==
            state.activeInvocationRef?.operationId
        ) {
          const settled = versionPreviewOperationRegistry.settleSuperseded(
            (identity) =>
              sameInvocationRef(
                identity.invocationRef,
                previous.activeInvocationRef!,
              ) &&
              identity.owner.hostId === "main-remote-machine-host" &&
              identity.owner.machineId === VERSION_PREVIEW_MACHINE_ID &&
              identity.owner.keyId === String(context.key.appId) &&
              identity.owner.actorInstanceId ===
                context.getMetadata().actorInstanceId,
          );
          if (settled > 0 && previousOperationId !== null) {
            versionPreviewPresentationService.settle(previousOperationId);
          }
        }
      },
    }),
    createOutcomePublisher: (context) => {
      const publish = createOperationOutcomePublisher(
        versionPreviewOperationRegistry,
        () => ({
          actor: context.getMetadata(),
          acknowledgedAt: Date.now(),
        }),
      );
      return (outcome: VersionPreviewCorrelatedOutcome) => {
        publish(outcome);
        versionPreviewPresentationService.settle(
          outcome.invocationRef.operationId,
        );
      };
    },
    commandSinkRevisionPolicy: "allow-advance",
    lifecycle: {
      subscriptionCreates: true,
      dispatchCreates: false,
      idleEviction: { kind: "retain" },
      terminalRetention: { kind: "retain" },
      entityDeletion: "dispose",
      rendererOwnership: "host",
      survivesRendererReload: true,
      restartPersistence: "persistent",
      flushOnShutdown: true,
      flush: async ({ key }) => {
        versionPreviewPersistence.flush(key.appId);
      },
      settleWaiters: ({ metadata }) => {
        versionPreviewOperationRegistry.settleActor(metadata.actorInstanceId);
      },
      onDisposed: ({ key, cause, metadata }) => {
        versionPreviewService.endReconciliation(key.appId);
        versionPreviewOperationRegistry.releaseOwned(
          "actor",
          (owner) => owner.actorInstanceId === metadata.actorInstanceId,
        );
        versionPreviewPresentationService.settleActor(metadata.actorInstanceId);
        if (cause === "entity-deletion") {
          versionPreviewPersistence.remove(key.appId);
        }
      },
    },
    remote: {
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      keyCodec: VersionPreviewKeySchema,
      encodeKey: (key) => key,
      canonicalizeKeyAfterAuthorization: (key) => versionPreviewKey(key.appId),
      eventCodec: z.custom<VersionPreviewActorEvent>(
        (value) => VersionPreviewIntentEventSchema.safeParse(value).success,
      ),
      snapshotCodec: VersionPreviewRemoteSnapshotSchema,
      keyToString: (key) => String(key.appId),
      projectSnapshot: (state, key, metadata) =>
        projectVersionPreviewRemoteSnapshot(
          key.appId,
          metadata.snapshotRevision,
          state,
        ),
      unavailableSnapshot: (key) =>
        projectVersionPreviewRemoteSnapshot(key.appId, 0, {
          state: CLOSED_STATE,
          activeInvocationRef: null,
          lastSettlement: null,
        }),
      revisionPolicy: () => "reject-stale",
      authorizeSubscribe: ({ key }) => authorizeApp(key.appId),
      authorizeDispatch: async ({ key }) => {
        if (key.appId === 0) {
          throw new DyadError(
            "A real app is required for version preview",
            DyadErrorKind.Auth,
          );
        }
        await authorizeApp(key.appId);
        versionPreviewService.assertReadyForIntent(key.appId);
      },
    },
    remoteIntent: defineRuntimeRemoteIntentContract<
      VersionPreviewKey,
      VersionPreviewActorState,
      VersionPreviewIntentEvent,
      VersionPreviewActorEvent,
      import("@/version_preview/transport").VersionPreviewRemoteSnapshot
    >({
      ...versionPreviewRemoteIntentContract,
      keyToString: (key: VersionPreviewKey) => String(key.appId),
      toInternalEvent: ({ intent, sender, requestIdentity }) => {
        const tracked =
          versionPreviewRemoteIntentContract.intents[intent.type].completion ===
          "tracked-completion";
        if (tracked && !requestIdentity) {
          throw new DyadError(
            "Version preview request identity is missing",
            DyadErrorKind.Validation,
          );
        }
        return Object.freeze({
          ...structuredClone(intent),
          windowSessionId: sender.windowSessionId,
          ...(requestIdentity ? { requestId: requestIdentity.requestId } : {}),
        }) as VersionPreviewAdmittedIntent;
      },
      authorizeSubscribe: async ({ key }) => {
        try {
          await authorizeApp(key.appId);
          return { kind: "allow" as const };
        } catch (error) {
          if (isDyadError(error)) return { kind: "deny" as const, error };
          throw error;
        }
      },
      authorizeDispatch: async ({ key }) => {
        try {
          await authorizeApp(key.appId);
          versionPreviewService.assertReadyForIntent(key.appId);
          return { kind: "allow" as const };
        } catch (error) {
          if (isDyadError(error)) {
            return { kind: "deny" as const, error };
          }
          throw error;
        }
      },
      finalizeOperation: (context, controls) => {
        const event = context.event as VersionPreviewAdmittedIntent;
        let routeHandle:
          | import("@/window_infrastructure/main/operation_route_registry").OperationRouteHandle
          | undefined;
        try {
          const owner: OperationOwner = {
            hostId: "main-remote-machine-host",
            machineId: VERSION_PREVIEW_MACHINE_ID,
            keyId: String(context.key.appId),
            actorInstanceId: context.actor.actorInstanceId,
            actorRevision: context.actor.snapshotRevision,
            windowSessionId: context.sender.windowSessionId,
          };
          const admission = finalizeOperationAdmission({
            registry: versionPreviewOperationRegistry,
            identity: {
              requestId: context.requestIdentity.requestId,
              fingerprint: context.fingerprint,
              owner,
            },
            createInvocationRef: () =>
              invocation(context.key.appId, event.operationId),
            assertFinalAdmission: controls.assertFinalAdmission,
            enqueue: () => {
              try {
                const route = versionPreviewPresentationService.recordInitiator(
                  context.key.appId,
                  event.operationId,
                  context.sender.windowSessionId,
                  context.actor.actorInstanceId,
                );
                if (route && route.kind !== "fresh") {
                  throw new DyadError(
                    "Version preview operation identity is already owned",
                    DyadErrorKind.Conflict,
                  );
                }
                routeHandle = route?.handle;
                return controls.enqueue();
              } catch (error) {
                if (routeHandle)
                  versionPreviewPresentationService.release(routeHandle);
                routeHandle = undefined;
                throw new VersionPreviewEnqueueError(
                  versionPreviewOperationKind(event),
                  error,
                );
              }
            },
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
                  versionPreviewOperationRegistry.rollbackAdmission(
                    context.requestIdentity.requestId,
                    admission.operation.invocationRef,
                    error,
                  );
                  if (routeHandle)
                    versionPreviewPresentationService.release(routeHandle);
                },
              }
            : {
                disposition: admission.kind,
                operation: admission.operation,
              };
        } catch (error) {
          if (routeHandle)
            versionPreviewPresentationService.release(routeHandle);
          if (error instanceof VersionPreviewEnqueueError) {
            throw error.originalError;
          }
          throw error;
        }
      },
      disposeWindowSession: (windowSessionId, controls) => {
        versionPreviewOperationRegistry.settleWindowSession(windowSessionId);
        controls.dispatchExisting(() => ({
          type: "WINDOW_INTEREST_DISPOSED",
          windowSessionId,
        }));
      },
    }),
  });
