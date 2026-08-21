import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDistributedMachine } from "@/distributed_machines/react";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { showError } from "@/lib/toast";
import { githubOpsClientDefinition } from "./client_definition";
import { projectGithubOps } from "./projection";
import type { GithubOpsEvent } from "./state";
import { githubOpsKey, type GithubOpsIntentEvent } from "./transport";

const UNAVAILABLE_CAPABILITIES = {
  canSync: false,
  canDisconnect: false,
  canAbortRebase: false,
  canContinueRebase: false,
  canSafeForcePush: false,
  canForcePush: false,
  canRebaseAndSync: false,
  canResolveConflicts: false,
  canCancelSync: false,
  canContinueSync: false,
  canRetryConflictVerification: false,
  canMutateBranches: false,
  canSwitchBranches: false,
  canConfirmBlockedSwitch: false,
  canDismissBlockedSwitch: false,
  canConnectRepository: false,
} as const;

function operationId(): string {
  return `github-operation:${globalThis.crypto.randomUUID()}`;
}

function conflictResolutionClaimId(): string {
  return `github-conflict-resolution:${globalThis.crypto.randomUUID()}`;
}

export function useGithubOps(
  appId: number | null,
  options: { reconcileOnMount?: boolean } = {},
) {
  const conflictClaimRef = useRef<string | null>(null);
  const routedAppId = appId ?? 0;
  const remote = useDistributedMachine(
    githubOpsClientDefinition,
    githubOpsKey(routedAppId),
    (snapshot) => projectGithubOps(snapshot.state),
  );

  const dispatch = useCallback(
    async (event: GithubOpsEvent) => {
      if (appId === null) return undefined;
      let intent: GithubOpsIntentEvent;
      switch (event.type) {
        case "OP_REQUESTED":
          intent = {
            ...event,
            operationId: operationId(),
            ...((event.op.type === "merge-abort" ||
              event.op.type === "rebase-abort") &&
            remote.state.activeInvocationRef
              ? { activeInvocationRef: remote.state.activeInvocationRef }
              : {}),
          };
          break;
        case "ABORT_AND_SWITCH_CONFIRMED":
          intent = { ...event, operationId: operationId() };
          break;
        case "BLOCKED_DISMISSED":
        case "BANNER_DISMISSED":
        case "RECONCILE_REQUESTED":
        case "RETRY_CONFLICT_VERIFICATION":
        case "CONFLICT_RESOLUTION_FINISHED":
          intent = event;
          break;
        case "RESOLVE_WITH_AI_STARTED": {
          if (conflictClaimRef.current) return undefined;
          const claimId = conflictResolutionClaimId();
          conflictClaimRef.current = claimId;
          intent = { ...event, claimId };
          break;
        }
        case "OP_SUCCEEDED":
        case "OP_FAILED":
        case "CONFLICTS":
        case "GIT_STATE":
        case "CONFLICT_RESOLUTION_STARTED":
        case "CONFLICT_VERIFICATION_FAILED":
          throw new Error(
            `${event.type} is a host-only GitHub operation event`,
          );
      }
      try {
        const receipt = await remote.dispatch(intent);
        if (
          event.type === "RESOLVE_WITH_AI_STARTED" &&
          receipt.kind !== "applied"
        ) {
          conflictClaimRef.current = null;
        }
        return receipt;
      } catch (error) {
        if (event.type === "RESOLVE_WITH_AI_STARTED") {
          conflictClaimRef.current = null;
        }
        throw error;
      }
    },
    [appId, remote.dispatch, remote.state.activeInvocationRef],
  );
  const dispatchWithErrorFeedback = useCallback(
    async (event: GithubOpsEvent) => {
      try {
        return await dispatch(event);
      } catch (error) {
        showError(
          isDyadError(error) && error.kind === DyadErrorKind.RateLimited
            ? error.message
            : "GitHub controls are temporarily unavailable. Please try again.",
        );
        return undefined;
      }
    },
    [dispatch],
  );
  const sendWithoutReceipt = useCallback(
    (event: GithubOpsEvent): void => {
      void dispatchWithErrorFeedback(event);
    },
    [dispatchWithErrorFeedback],
  );

  const projection = useMemo(
    () =>
      remote.connection === "ready"
        ? remote.projection
        : {
            ...remote.projection,
            capabilities: UNAVAILABLE_CAPABILITIES,
          },
    [remote.connection, remote.projection],
  );

  const reconcileOnMount = options.reconcileOnMount ?? true;
  useEffect(() => {
    if (appId === null || !reconcileOnMount || remote.connection !== "ready") {
      return;
    }
    const reconcile = () => sendWithoutReceipt({ type: "RECONCILE_REQUESTED" });
    reconcile();
    window.addEventListener("focus", reconcile);
    return () => window.removeEventListener("focus", reconcile);
  }, [appId, reconcileOnMount, remote.connection, sendWithoutReceipt]);

  const dispatchConflictResolutionStarted = useCallback(
    async (chatId: number) => {
      const claimId = conflictClaimRef.current;
      if (!claimId) {
        throw new Error("Conflict-resolution claim is no longer available");
      }
      try {
        const receipt = await remote.dispatch({
          type: "CONFLICT_RESOLUTION_STARTED",
          claimId,
          chatId,
        });
        if (receipt.kind !== "applied") {
          throw new Error("Conflict-resolution claim was not accepted");
        }
      } finally {
        conflictClaimRef.current = null;
      }
    },
    [remote.dispatch],
  );

  const dispatchConflictResolutionCancelled = useCallback(async () => {
    const claimId = conflictClaimRef.current;
    if (!claimId) return;
    try {
      const receipt = await remote.dispatch({
        type: "CONFLICT_RESOLUTION_CANCELLED",
        claimId,
      });
      if (receipt.kind !== "applied") {
        throw new Error("Conflict-resolution cancellation was not accepted");
      }
    } finally {
      conflictClaimRef.current = null;
    }
  }, [remote.dispatch]);

  return {
    state: remote.state.state,
    projection,
    connection: remote.connection,
    revision: remote.state.revision,
    activeInvocationRef: remote.state.activeInvocationRef,
    conflictResolutionClaimed: remote.state.conflictResolutionClaimed,
    send: sendWithoutReceipt,
    dispatchWithErrorFeedback,
    dispatch,
    dispatchConflictResolutionStarted,
    dispatchConflictResolutionCancelled,
  };
}

export type GithubOpsDispatchReceipt = Awaited<
  ReturnType<ReturnType<typeof useGithubOps>["dispatch"]>
>;

export function isAppliedGithubOpsReceipt(
  receipt: GithubOpsDispatchReceipt,
): receipt is Extract<
  NonNullable<GithubOpsDispatchReceipt>,
  { kind: "applied" }
> {
  return receipt?.kind === "applied";
}
