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
import { CLOSED_STATE, type PreviewCommand } from "@/version_preview/state";
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
    command.type === "restore-to-message"
  );
}

function isFailureEvent(event: VersionPreviewWireEvent): boolean {
  return (
    event.type === "ORIGIN_RESOLUTION_FAILED" ||
    event.type === "CHECKOUT_FAILED" ||
    event.type === "RESTORE_FAILED" ||
    event.type === "RETURN_FAILED" ||
    event.type === "SWITCH_BRANCH_FAILED"
  );
}

function producerError(
  event: VersionPreviewProducerEvent,
): { message: string } | undefined {
  return "error" in event ? event.error : undefined;
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
    } else if (current.session.originBranch === null) {
      // A restore started from the live branch does not own a historical
      // checkout, so there is no branch to return to after restart.
      state = CLOSED_STATE;
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
      ? actorState.activeInvocationRef
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
            ({ branch }) => context.send({ type: "RECONCILED", branch }),
            () => context.send({ type: "RECONCILED", branch: null }),
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
        try {
          versionPreviewPersistence.checkpoint(
            appId,
            context.getSnapshot().state,
          );
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
        const lifecycle = versionPreviewService
          .run(command, invocationRef.operationId)
          .then(
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
                    emit({
                      type: "RESTORE_FAILED",
                      error: info,
                      invocationRef,
                    });
                    break;
                }
              }
            },
          );
        void versionPreviewService
          .trackLifecycle(appId, lifecycle)
          .catch((error) => {
            versionPreviewPresentationService.publishError(
              appId,
              invocationRef.operationId,
              `Version preview completion failed: ${errorInfo(error).message}`,
            );
          });
        return;
      }
      case "notify-error":
        if (invocationRef) {
          versionPreviewPresentationService.publishError(
            appId,
            invocationRef.operationId,
            command.message,
          );
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
  import("@/version_preview/transition").PreviewIgnoreReason | "stale-operation"
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
      | "stale-operation"
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
    const runner = createCommandRunner(context);
    if (context.getSnapshot().state.type !== "closed") {
      versionPreviewService.beginReconciliation(context.key.appId);
      queueMicrotask(() => context.send({ type: "RECONCILE_REQUESTED" }));
    }
    return runner;
  },
  createObserver: (context) => ({
    onTransitionApplied: ({ state, event }) => {
      versionPreviewPersistence.schedule(context.key.appId, state.state);
      if (state.state.type === "closed") {
        versionPreviewWindowInterestService.clearApp(context.key.appId);
      }
      if ("operationId" in event) {
        versionPreviewPresentationService.confirm(event.operationId);
      }
      if (state.activeInvocationRef === null) {
        const operationId =
          "operationId" in event
            ? event.operationId
            : "invocationRef" in event
              ? event.invocationRef.operationId
              : state.lastSettlement?.operationId;
        if (operationId) versionPreviewPresentationService.forget(operationId);
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
    canonicalizeKeyAfterAuthorization: (key) => versionPreviewKey(key.appId),
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
};
