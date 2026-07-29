import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDistributedMachine } from "@/distributed_machines/react";
import { useMachineMutation } from "@/distributed_machines/use_machine_mutation";
import { showError } from "@/lib/toast";
import { githubOpsClientDefinition } from "./client_definition";
import { projectGithubOps } from "./projection";
import type { GithubOpsEvent, GithubOpsOperationOutcome } from "./state";
import {
  type GithubOpsAdmissionOnlyIntent,
  type GithubOpsPreparedRequest,
  type GithubOpsReceipt,
  type GithubOpsTrackedIntent,
  useGithubOpsRequestActor,
} from "./request_actor";
import { githubOpsKey, isGithubOpsStateSensitiveIntent } from "./transport";

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

function classifyOutcome(outcome: GithubOpsOperationOutcome) {
  switch (outcome.kind) {
    case "succeeded":
      return { kind: "succeeded" as const };
    case "cancelled":
      return outcome.reason === "superseded"
        ? { kind: "superseded" as const }
        : { kind: "cancelled" as const };
    case "failed":
    case "rejected":
      return { kind: "failed" as const, error: outcome };
  }
}

export function useGithubOps(
  appId: number | null,
  options: { reconcileOnMount?: boolean } = {},
) {
  const conflictClaimRef = useRef<string | null>(null);
  const latestRequestRef = useRef<GithubOpsPreparedRequest | undefined>(
    undefined,
  );
  const retriedWhileReadyRef = useRef<string | null>(null);
  const routedAppId = appId ?? 0;
  const remote = useDistributedMachine(
    githubOpsClientDefinition,
    githubOpsKey(routedAppId),
    (snapshot) => projectGithubOps(snapshot.state),
  );
  const actor = useGithubOpsRequestActor(routedAppId);
  const mutation = useMachineMutation({
    connection: remote.connection,
    snapshot: remote.snapshot,
    request: (
      intent: GithubOpsTrackedIntent,
      observedRevision,
    ): GithubOpsPreparedRequest => {
      const request = actor.request(intent, observedRevision);
      latestRequestRef.current = request;
      return request;
    },
    classifyOutcome,
    requestOwnership: "parallel",
  });
  useEffect(() => {
    if (remote.connection !== "ready") {
      retriedWhileReadyRef.current = null;
      return;
    }
    if (
      mutation.admission.kind !== "refused" ||
      mutation.admission.reason !== "disconnected" ||
      !mutation.admission.retryable
    ) {
      return;
    }
    const requestId = latestRequestRef.current?.requestId;
    if (!requestId || retriedWhileReadyRef.current === requestId) return;
    retriedWhileReadyRef.current = requestId;
    void mutation.retry().catch(() => undefined);
  }, [mutation.admission, mutation.retry, remote.connection]);

  const dispatchTracked = useCallback(
    async (
      intent: GithubOpsTrackedIntent,
    ): Promise<GithubOpsReceipt | undefined> => {
      const settlement = mutation.mutate(intent);
      const prepared = latestRequestRef.current;
      if (!prepared) {
        void settlement.catch(() => undefined);
        throw new Error("GitHub operation request was not prepared");
      }
      void settlement.catch(() => undefined);
      const admission = await prepared.admission;
      switch (admission.kind) {
        case "admitted":
          return admission.admission;
        case "refused":
          return admission.reason;
        case "disconnected":
        case "disposed":
          return undefined;
      }
    },
    [mutation.mutate],
  );

  const dispatchAdmissionOnly = useCallback(
    (intent: GithubOpsAdmissionOnlyIntent) =>
      actor.sendAdmissionOnly(
        intent,
        isGithubOpsStateSensitiveIntent(intent)
          ? remote.observedRevision
          : undefined,
      ),
    [actor, remote.observedRevision],
  );

  const dispatch = useCallback(
    async (event: GithubOpsEvent): Promise<GithubOpsReceipt | undefined> => {
      if (appId === null) return undefined;
      switch (event.type) {
        case "OP_REQUESTED":
          return dispatchTracked({
            ...event,
            operationId: operationId(),
            ...((event.op.type === "merge-abort" ||
              event.op.type === "rebase-abort") &&
            remote.state.activeInvocationRef
              ? { activeInvocationRef: remote.state.activeInvocationRef }
              : {}),
          });
        case "ABORT_AND_SWITCH_CONFIRMED":
          return dispatchTracked({ ...event, operationId: operationId() });
        case "BLOCKED_DISMISSED":
        case "BANNER_DISMISSED":
        case "RECONCILE_REQUESTED":
          return dispatchAdmissionOnly(event);
        case "RESOLVE_WITH_AI_STARTED": {
          if (conflictClaimRef.current) return undefined;
          const claimId = conflictResolutionClaimId();
          conflictClaimRef.current = claimId;
          try {
            const receipt = await dispatchAdmissionOnly({ ...event, claimId });
            if (receipt.kind !== "applied") conflictClaimRef.current = null;
            return receipt;
          } catch (error) {
            conflictClaimRef.current = null;
            throw error;
          }
        }
        case "OP_SUCCEEDED":
        case "OP_FAILED":
        case "CONFLICTS":
        case "GIT_STATE":
          throw new Error(
            `${event.type} is a host-only GitHub operation event`,
          );
      }
    },
    [
      appId,
      dispatchAdmissionOnly,
      dispatchTracked,
      remote.state.activeInvocationRef,
    ],
  );

  const dispatchWithErrorFeedback = useCallback(
    async (event: GithubOpsEvent) => {
      try {
        return await dispatch(event);
      } catch {
        showError(
          "GitHub controls are temporarily unavailable. Please try again.",
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

  const dispatchConflictResolutionStarted = useCallback(async () => {
    const claimId = conflictClaimRef.current;
    if (!claimId) {
      throw new Error("Conflict-resolution claim is no longer available");
    }
    try {
      const receipt = await dispatchAdmissionOnly({
        type: "CONFLICT_RESOLUTION_STARTED",
        claimId,
      });
      if (receipt.kind !== "applied") {
        throw new Error("Conflict-resolution claim was not accepted");
      }
    } finally {
      conflictClaimRef.current = null;
    }
  }, [dispatchAdmissionOnly]);

  const dispatchConflictResolutionCancelled = useCallback(async () => {
    const claimId = conflictClaimRef.current;
    if (!claimId) return;
    try {
      const receipt = await dispatchAdmissionOnly({
        type: "CONFLICT_RESOLUTION_CANCELLED",
        claimId,
      });
      if (receipt.kind !== "applied") {
        throw new Error("Conflict-resolution cancellation was not accepted");
      }
    } finally {
      conflictClaimRef.current = null;
    }
  }, [dispatchAdmissionOnly]);

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
