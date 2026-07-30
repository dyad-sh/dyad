import { useMemo } from "react";
import {
  type RemoteMachineClient,
  RemoteMachineTransportError,
  type ObservedRevisionToken,
} from "@/distributed_machines/remote_client";
import { createRemoteRequestActor } from "@/distributed_machines/request_actor";
import type { PreparedRequest } from "@/distributed_machines/prepared_request";
import type { PreparedAdmission } from "@/distributed_machines/prepared_request";
import type { MachineDispatchReceipt } from "@/distributed_machines/remote_protocol";
import { uuidIdSource } from "@/state_machines/clock";
import { useRemoteMachineClient } from "@/distributed_machines/react";
import { versionPreviewClientDefinition } from "./client_definition";
import {
  versionPreviewKey,
  type VersionPreviewIntentEvent,
  type VersionPreviewRemoteSnapshot,
} from "./transport";
import {
  versionPreviewOperationKind,
  type VersionPreviewOperationOutcome,
} from "./operations";
import { useVersionPreviewRequestScope } from "./request_scope";

type VersionPreviewReason =
  | import("./transition").PreviewIgnoreReason
  | "stale-operation"
  | "interest-already-owned"
  | "interest-owned-by-another-window";

export type VersionPreviewAdmission =
  MachineDispatchReceipt<VersionPreviewReason>;
export type VersionPreviewRefusal =
  | Extract<VersionPreviewAdmission, { readonly kind: "rejected" }>["reason"]
  | VersionPreviewReason;

export interface VersionPreviewRequestInput {
  readonly intent: VersionPreviewIntentEvent;
  readonly observed?: ObservedRevisionToken;
}

export interface VersionPreviewRequestActor {
  request(
    input: VersionPreviewRequestInput,
  ): PreparedRequest<
    VersionPreviewAdmission,
    VersionPreviewOperationOutcome,
    VersionPreviewRefusal
  >;
}

/**
 * Observes admission for renderer presentation and performs one stable-identity
 * retry when delivery may have succeeded but the receipt was lost.
 *
 * A second disconnect is detached explicitly so the request's settlement
 * cannot remain unresolved forever after the automatic retry is exhausted.
 */
export async function observeVersionPreviewAdmission(
  prepared: PreparedRequest<
    VersionPreviewAdmission,
    VersionPreviewOperationOutcome,
    VersionPreviewRefusal
  >,
  onAdmitted: (admission: VersionPreviewAdmission) => void,
): Promise<void> {
  let admission: PreparedAdmission<
    VersionPreviewAdmission,
    VersionPreviewRefusal
  > = await prepared.admission;
  if (
    admission.kind === "disconnected" &&
    admission.retryable &&
    prepared.retry.kind === "enabled"
  ) {
    admission = await prepared.retry.dispatch();
  }
  if (admission.kind === "admitted") {
    onAdmitted(admission.admission);
    return;
  }
  if (admission.kind === "disconnected" && admission.retryable) {
    prepared.detach();
  }
}

export function createVersionPreviewRequestActor(
  client: RemoteMachineClient,
  scope: import("@/distributed_machines/prepared_request").PreparedRequestScope,
  appId: number,
): VersionPreviewRequestActor {
  const actor = client.actor<
    import("./transport").VersionPreviewKey,
    VersionPreviewRemoteSnapshot,
    VersionPreviewIntentEvent,
    VersionPreviewReason
  >(versionPreviewClientDefinition, versionPreviewKey(appId));
  return createRemoteRequestActor<
    VersionPreviewRequestInput,
    VersionPreviewIntentEvent,
    VersionPreviewRemoteSnapshot,
    VersionPreviewReason,
    VersionPreviewAdmission,
    VersionPreviewOperationOutcome,
    VersionPreviewRefusal
  >({
    actor,
    scope,
    ids: uuidIdSource,
    windowSessionId: scope.windowSessionId,
    snapshotInput: (input: VersionPreviewRequestInput) =>
      Object.freeze(structuredClone(input)),
    prepareIntent: (input) => ({
      intent: input.intent,
      expected: input.observed,
    }),
    fingerprint: (_identity, input) =>
      JSON.stringify({ appId, intent: input.intent, observed: input.observed }),
    selectOutcome: (view, requestId, input) => {
      const settlement = view.state.lastSettlement;
      // Protocol-v1 snapshots retain only the historical operation identity.
      // Current correlated requests settle through the authoritative operation
      // outcome channel; this fallback remains solely for a matching legacy
      // snapshot.
      if (!settlement || settlement.operationId !== requestId) {
        return undefined;
      }
      return settlement.outcome === "succeeded"
        ? {
            kind: "succeeded" as const,
            operation: versionPreviewOperationKind(input.intent),
          }
        : {
            kind: "failed" as const,
            operation: versionPreviewOperationKind(input.intent),
            error: settlement.error ?? {
              message: "Version operation failed",
            },
          };
    },
    outcomeOnUnavailable: () => ({
      kind: "cancelled",
      reason: "actor-disposed",
    }),
    admissionFromReceipt: (receipt) =>
      receipt.kind === "rejected" || receipt.kind === "ignored"
        ? { kind: "refused", reason: receipt.reason }
        : receipt,
    isRefusal: (
      value,
    ): value is {
      readonly kind: "refused";
      readonly reason: VersionPreviewRefusal;
    } => value.kind === "refused",
    classifyFailure: (error) =>
      error instanceof RemoteMachineTransportError
        ? {
            kind: "disconnect",
            retryable: true,
            admission: "unknown",
          }
        : { kind: "unexpected" },
    retry: {
      kind: "stable-id",
      receiverDeduplication: "required",
    },
  });
}

export function useVersionPreviewRequestActor(
  appId: number,
): VersionPreviewRequestActor {
  const client = useRemoteMachineClient();
  const scope = useVersionPreviewRequestScope();
  return useMemo(
    () => createVersionPreviewRequestActor(client, scope, appId),
    [appId, client, scope],
  );
}
