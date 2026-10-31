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
import {
  CLOSED_STATE,
  isRestoreRecoveryFlowState,
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
  type VersionPreviewIntentEvent,
  type VersionPreviewInvocationRef,
  type VersionPreviewKey,
  type VersionPreviewProducerEvent,
  type VersionPreviewWireEvent,
} from "@/version_preview/transport";
import { appRunActorService } from "./app_run_actor_service";
import { versionPreviewPresentationService } from "./version_preview_presentation_service";
import { versionPreviewService } from "./version_preview_service";
import { versionPreviewPersistence } from "./version_preview_persistence";
import { versionPreviewWindowInterestService } from "./version_preview_window_interest";
import { versionPreviewRemoteIntentContract } from "@/version_preview/remote_intent_contract";
import { chatExecutionHold } from "./chat_execution_hold";

const RESTORE_RECOVERY_EXECUTION_HOLD = "restore-recovery-execution-hold";

interface VersionPreviewActorCommand {
  readonly command: PreviewCommand | { readonly type: "reconcile" };
  readonly invocationRef: VersionPreviewInvocationRef | null;
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
  event: VersionPreviewWireEvent,
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
  event: VersionPreviewWireEvent,
): event is VersionPreviewIntentEvent {
  return "operationId" in event;
}

function isMutationCommand(command: PreviewCommand): boolean {
  return (
    command.type === "checkout" ||
    command.type === "return" ||
    command.type === "switch-branch" ||
    command.type === "restore" ||
    command.type === "restore-to-message" ||
    command.type === "validate-current-repository" ||
    command.type === "checkpoint-current-repository"
  );
}

function isFailureEvent(event: VersionPreviewWireEvent): boolean {
  return (
    event.type === "ORIGIN_RESOLUTION_FAILED" ||
    event.type === "CHECKOUT_FAILED" ||
    event.type === "RESTORE_FAILED" ||
    event.type === "RESTORE_RECOVERY_REQUIRED" ||
    event.type === "CURRENT_REPOSITORY_DIRTY" ||
    event.type === "CURRENT_REPOSITORY_REJECTED" ||
    event.type === "RETURN_FAILED" ||
    event.type === "SWITCH_BRANCH_FAILED"
  );
}

function producerError(
  event: VersionPreviewProducerEvent,
): { message: string } | undefined {
  return "error" in event ? event.error : undefined;
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
  event: VersionPreviewWireEvent,
) {
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
  const completedProducer = !isIntent(event) && !hasFollowup;
  const lastSettlement = completedProducer
    ? {
        operationId: event.invocationRef.operationId,
        outcome: isFailureEvent(event)
          ? ("failed" as const)
          : ("succeeded" as const),
        ...(producerError(event) ? { error: producerError(event) } : {}),
      }
    : actorState.lastSettlement;
  const activeInvocationRef = hasFollowup
    ? currentRef
    : isIntent(event)
      ? result.state.type === "closed"
        ? null
        : actorState.activeInvocationRef
      : null;

  return {
    kind: "applied" as const,
    state: {
      state: result.state,
      activeInvocationRef,
      lastSettlement,
    },
    commands: result.commands.map((command) => ({
      command,
      invocationRef: currentRef,
    })),
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
    VersionPreviewWireEvent
  >,
) {
  let resolveEpoch = 0;
  const emit = (event: VersionPreviewProducerEvent) => context.send(event);

  return ({ command, invocationRef }: VersionPreviewActorCommand): void => {
    const appId = context.key.appId;
    switch (command.type) {
      case "reconcile":
        void versionPreviewService
          .reconcile(appId)
          .then(
            ({ branch, headOid, isClean }) =>
              context.send({ type: "RECONCILED", branch, headOid, isClean }),
            () =>
              context.send({
                type: "RECONCILED",
                branch: null,
                headOid: null,
                isClean: false,
              }),
          )
          .finally(() => versionPreviewService.endReconciliation(appId));
        return;
      case "resolve-origin": {
        if (!invocationRef) return;
        const epoch = ++resolveEpoch;
        void versionPreviewService.resolveOriginBranch(appId).then(
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
        return;
      }
      case "checkout":
      case "return":
      case "switch-branch":
      case "restore":
      case "restore-to-message": {
        if (!invocationRef) return;
        let restoreProgress: RestoreRecovery | null = null;
        const isRestore =
          command.type === "restore" || command.type === "restore-to-message";
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
          return;
        }
        // Codebase restores own the hold through Git/database restoration and restart.
        // The chat actor keeps accepting durable queued prompts in the meantime.
        const releaseChatExecution =
          command.type === "restore" ||
          (command.type === "restore-to-message" && command.restoreCodebase)
            ? chatExecutionHold.acquire(appId)
            : undefined;
        const operation =
          command.type === "restore" || command.type === "restore-to-message"
            ? versionPreviewService.run(
                command,
                invocationRef.operationId,
                (progress) => {
                  const recovery =
                    command.type === "restore-to-message"
                      ? { ...progress, affectedChatId: command.chatId }
                      : progress;
                  versionPreviewPersistence.checkpointRestore(
                    appId,
                    context.getSnapshot().state,
                    recovery,
                  );
                  restoreProgress = recovery;
                  if (
                    releaseChatExecution &&
                    recovery.nextStep !== "preparing" &&
                    recovery.nextStep !== "completed"
                  ) {
                    // Before crossing a restore boundary, give the actor its
                    // own hold. It survives lifecycle failure until recovery
                    // is accepted, without a release/reacquire dispatch gap.
                    context.tasks.replace(
                      RESTORE_RECOVERY_EXECUTION_HOLD,
                      chatExecutionHold.acquire(appId),
                    );
                  }
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
        void versionPreviewService
          .trackLifecycle(
            appId,
            lifecycle.finally(() => releaseChatExecution?.()),
          )
          .catch((error) => {
            versionPreviewPresentationService.publishError(
              appId,
              invocationRef.operationId,
              `Version preview completion failed: ${errorInfo(error).message}`,
            );
          });
        return;
      }
      case "validate-current-repository":
      case "checkpoint-current-repository": {
        if (!invocationRef) return;
        // Keep in-flight recovery work held even if actor disposal releases
        // the longer-lived recovery hold before the service finishes.
        const releaseChatExecution = chatExecutionHold.acquire(appId);
        const operation =
          command.type === "validate-current-repository"
            ? versionPreviewService.validateCurrentRepository(appId)
            : versionPreviewService.checkpointCurrentRepository(appId);
        const lifecycle = operation.then(
          (result) => {
            if (result.kind === "dirty") {
              emit({ type: "CURRENT_REPOSITORY_DIRTY", invocationRef });
              return;
            }
            if (result.kind === "blocked") {
              emit({
                type: "CURRENT_REPOSITORY_REJECTED",
                error: { message: result.message },
                assessment: result.assessment,
                invocationRef,
              });
              return;
            }

            try {
              const recoveryState = context.getSnapshot().state;
              const affectedChatId = isRestoreRecoveryFlowState(recoveryState)
                ? (recoveryState.restoreRecovery?.affectedChatId ?? null)
                : null;
              const originHandledScopes = [
                { family: "branches", appId },
                { family: "versions", appId },
                { family: "app", appId },
                { family: "problems", appId },
              ] as const;
              const scopes = [
                ...originHandledScopes,
                { family: "chats" },
                ...(affectedChatId
                  ? ([{ family: "chat", chatId: affectedChatId }] as const)
                  : []),
              ] as const;
              queryInvalidationBus.publish(scopes, {
                originEndpoint:
                  versionPreviewPresentationService.originEndpointFor(
                    invocationRef.operationId,
                  ),
                originHandledScopes,
              });
              versionPreviewPresentationService.publishResult(
                appId,
                invocationRef.operationId,
                {
                  repositoryOutcome: "unchanged",
                  notification: result.savedVersionId
                    ? {
                        kind: "success",
                        message:
                          "Current changes saved as a recovery version. Version History is ready.",
                      }
                    : {
                        kind: "success",
                        message:
                          "Version History is ready. Continuing from the current code version.",
                      },
                  runtimeAction: "none",
                  affectedChatId,
                  createdChatId: null,
                },
              );
            } finally {
              emit({
                type: "CURRENT_REPOSITORY_ACCEPTED",
                appId,
                branch: result.branch,
                acceptedHead: result.headOid,
                savedVersionId: result.savedVersionId,
                invocationRef,
              });
            }
          },
          (error) => {
            emit({
              type: "CURRENT_REPOSITORY_REJECTED",
              error: errorInfo(error),
              assessment: {
                type: "blocked",
                blocker: "repository-error",
              },
              invocationRef,
            });
          },
        );
        void versionPreviewService
          .trackLifecycle(appId, lifecycle.finally(releaseChatExecution))
          .catch((error) => {
            versionPreviewPresentationService.publishError(
              appId,
              invocationRef.operationId,
              `Version recovery completion failed: ${errorInfo(error).message}`,
            );
          });
        return;
      }
      case "notify-error":
        if (invocationRef) {
          try {
            versionPreviewPresentationService.publishError(
              appId,
              invocationRef.operationId,
              command.message,
            );
          } finally {
            versionPreviewPresentationService.forget(invocationRef.operationId);
          }
        }
        return;
      case "notify-recovery":
      case "dismiss-recovery":
        // Recovery is a durable snapshot fact. Every subscribed renderer
        // derives the disabled controls/error surface from that projection.
        return;
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
  VersionPreviewWireEvent,
  VersionPreviewActorCommand,
  | import("@/version_preview/transition").PreviewIgnoreReason
  | "stale-operation",
  VersionPreviewIntentEvent
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      typeof VERSION_PREVIEW_MACHINE_ID,
      VersionPreviewKey,
      VersionPreviewActorState,
      VersionPreviewWireEvent,
      VersionPreviewActorCommand,
      | import("@/version_preview/transition").PreviewIgnoreReason
      | "stale-operation",
      VersionPreviewIntentEvent
    >["remote"]
  >;
};

export const versionPreviewDefinition: Definition = {
  id: VERSION_PREVIEW_MACHINE_ID,
  host: "main",
  initialState: (key) => ({
    state: versionPreviewPersistence.load(key.appId),
    activeInvocationRef: null,
    lastSettlement: null,
  }),
  transition: (state, event, key) => transitionActor(key, state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) void execute(command);
    },
  }),
  createCommandRunner: (context) => {
    const initialState = context.getSnapshot().state;
    if (
      initialState.type === "restoring" ||
      isRestoreRecoveryFlowState(initialState)
    ) {
      // Rehydration must block chat execution while reconciliation determines
      // whether an interrupted restore still needs recovery.
      context.tasks.replace(
        RESTORE_RECOVERY_EXECUTION_HOLD,
        chatExecutionHold.acquire(context.key.appId),
      );
    }
    const runner = createCommandRunner(context);
    if (context.getSnapshot().state.type !== "closed") {
      versionPreviewService.beginReconciliation(context.key.appId);
      queueMicrotask(() => context.send({ type: "RECONCILE_REQUESTED" }));
    }
    return runner;
  },
  createObserver: (context) => ({
    onTransitionApplied: ({ previous, state, event, commands }) => {
      if (
        state.state.type !== "restoring" &&
        !isRestoreRecoveryFlowState(state.state)
      ) {
        context.tasks.remove(RESTORE_RECOVERY_EXECUTION_HOLD);
      }
      versionPreviewPersistence.schedule(context.key.appId, state.state);
      if (state.state.type === "closed") {
        versionPreviewWindowInterestService.clearApp(context.key.appId);
      }
      const previousOperationId =
        previous.activeInvocationRef?.operationId ?? null;
      const activeOperationId = state.activeInvocationRef?.operationId ?? null;
      if ("operationId" in event) {
        versionPreviewPresentationService.confirm(event.operationId);
        if (event.operationId !== activeOperationId) {
          versionPreviewPresentationService.forget(event.operationId);
        }
      }
      if (
        previousOperationId !== null &&
        previousOperationId !== activeOperationId &&
        !commands.some(
          ({ command, invocationRef }) =>
            command.type === "notify-error" &&
            invocationRef?.operationId === previousOperationId,
        )
      ) {
        versionPreviewPresentationService.forget(previousOperationId);
      }
    },
    onEventIgnored: ({ event }) => {
      if ("operationId" in event) {
        versionPreviewPresentationService.forget(event.operationId);
      }
    },
  }),
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
      await versionPreviewService.settle(key.appId);
      versionPreviewPersistence.flush(key.appId);
    },
    onDisposed: ({ key, cause }) => {
      versionPreviewService.endReconciliation(key.appId);
      versionPreviewWindowInterestService.clearApp(key.appId);
      if (cause === "entity-deletion") {
        versionPreviewPersistence.remove(key.appId);
      }
    },
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: VersionPreviewKeySchema,
    encodeKey: (key) => key,
    canonicalizeKeyAfterAuthorization: (key) => {
      // Authorization awaits the database, so deletion/reset may begin before
      // the host reaches its final synchronous actor-creation boundary.
      versionPreviewService.assertAcceptingOperations(key.appId);
      return versionPreviewKey(key.appId);
    },
    eventCodec:
      VersionPreviewIntentEventSchema as z.ZodType<VersionPreviewWireEvent>,
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
    authorizeDispatch: async ({ sender, key, event }) => {
      if (key.appId === 0) {
        throw new DyadError(
          "A real app is required for version preview",
          DyadErrorKind.Auth,
        );
      }
      await authorizeApp(key.appId);
      versionPreviewService.assertReadyForIntent(key.appId);
      versionPreviewPresentationService.recordInitiator(
        (event as VersionPreviewIntentEvent).operationId,
        sender.windowSessionId,
      );
    },
  },
  remoteIntentDeclaration: versionPreviewRemoteIntentContract,
};
