import { useCallback, useEffect } from "react";
import { useDistributedMachine } from "@/distributed_machines/react";
import { githubOpsClientDefinition } from "./client_definition";
import { projectGithubOps } from "./projection";
import type { GithubOpsEvent } from "./state";
import { githubOpsKey, type GithubOpsIntentEvent } from "./transport";

function operationId(): string {
  return `github-operation:${globalThis.crypto.randomUUID()}`;
}

export function useGithubOps(
  appId: number | null,
  options: { reconcileOnMount?: boolean } = {},
) {
  const routedAppId = appId ?? 0;
  const remote = useDistributedMachine(
    githubOpsClientDefinition,
    githubOpsKey(routedAppId),
    (snapshot) => projectGithubOps(snapshot.state),
  );

  const send = useCallback(
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
        case "RESOLVE_WITH_AI_STARTED":
        case "BANNER_DISMISSED":
        case "RECONCILE_REQUESTED":
          intent = event;
          break;
        case "OP_SUCCEEDED":
        case "OP_FAILED":
        case "CONFLICTS":
        case "GIT_STATE":
          throw new Error(
            `${event.type} is a host-only GitHub operation event`,
          );
      }
      return remote.dispatch(intent);
    },
    [appId, remote.dispatch, remote.state.activeInvocationRef],
  );

  const reconcileOnMount = options.reconcileOnMount ?? true;
  useEffect(() => {
    if (appId === null || !reconcileOnMount) return;
    const reconcile = () => void send({ type: "RECONCILE_REQUESTED" });
    reconcile();
    window.addEventListener("focus", reconcile);
    return () => window.removeEventListener("focus", reconcile);
  }, [appId, reconcileOnMount, send]);

  return {
    state: remote.state.state,
    projection: remote.projection,
    connection: remote.connection,
    revision: remote.state.revision,
    activeInvocationRef: remote.state.activeInvocationRef,
    send,
    dispatchConflictResolutionStarted: () =>
      remote.dispatch({ type: "CONFLICT_RESOLUTION_STARTED" }),
    dispatchConflictResolutionCancelled: () =>
      remote.dispatch({ type: "CONFLICT_RESOLUTION_CANCELLED" }),
  };
}

export type GithubOpsDispatchReceipt = Awaited<
  ReturnType<ReturnType<typeof useGithubOps>["send"]>
>;

export function isAppliedGithubOpsReceipt(
  receipt: GithubOpsDispatchReceipt,
): receipt is Extract<
  NonNullable<GithubOpsDispatchReceipt>,
  { kind: "applied" }
> {
  return receipt?.kind === "applied";
}
