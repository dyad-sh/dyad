import { useMemo } from "react";
import {
  createRemoteRequestActor,
  dispatchRemoteAdmissionOnly,
} from "@/distributed_machines/request_actor";
import type { PreparedRequest } from "@/distributed_machines/prepared_request";
import {
  RemoteMachineTransportError,
  type ObservedRevisionToken,
} from "@/distributed_machines/remote_client";
import { useRemoteMachineClient } from "@/distributed_machines/react";
import type { MachineDispatchReceipt } from "@/distributed_machines/remote_protocol";
import { uuidIdSource } from "@/state_machines/clock";
import type { GithubOpsIgnoreReason, GithubOpsOperationOutcome } from "./state";
import { githubOpsClientDefinition } from "./client_definition";
import { useGithubOpsRequestScope } from "./request_scope";
import {
  githubOpsKey,
  type GithubOpsIntentEvent,
  type GithubOpsRemoteSnapshot,
} from "./transport";

export type GithubOpsReceipt = MachineDispatchReceipt<
  GithubOpsIgnoreReason | "stale-operation"
>;
export type GithubOpsAdmission = Extract<
  GithubOpsReceipt,
  { readonly kind: "applied" }
>;
export type GithubOpsRefusal =
  | GithubOpsIgnoreReason
  | "stale-operation"
  | Extract<GithubOpsReceipt, { readonly kind: "rejected" }>["reason"];

export type GithubOpsTrackedIntent = Extract<
  GithubOpsIntentEvent,
  { readonly type: "OP_REQUESTED" | "ABORT_AND_SWITCH_CONFIRMED" }
>;
export type GithubOpsAdmissionOnlyIntent = Exclude<
  GithubOpsIntentEvent,
  GithubOpsTrackedIntent
>;

export type GithubOpsPreparedRequest = PreparedRequest<
  GithubOpsAdmission,
  GithubOpsOperationOutcome,
  GithubOpsRefusal
>;

export interface GithubOpsRequestActor {
  request(
    intent: GithubOpsTrackedIntent,
    observedRevision?: ObservedRevisionToken,
  ): GithubOpsPreparedRequest;
  sendAdmissionOnly(
    intent: GithubOpsAdmissionOnlyIntent,
    observedRevision?: ObservedRevisionToken,
  ): Promise<GithubOpsReceipt>;
}

export function useGithubOpsRequestActor(appId: number): GithubOpsRequestActor {
  const client = useRemoteMachineClient();
  const scope = useGithubOpsRequestScope();
  const actor = client.actor<
    ReturnType<typeof githubOpsKey>,
    GithubOpsRemoteSnapshot,
    GithubOpsIntentEvent,
    GithubOpsIgnoreReason | "stale-operation"
  >(githubOpsClientDefinition, githubOpsKey(appId));

  return useMemo(() => {
    type RequestInput = {
      readonly intent: GithubOpsTrackedIntent;
      readonly observedRevision?: ObservedRevisionToken;
    };
    const completionAware = createRemoteRequestActor<
      RequestInput,
      GithubOpsIntentEvent,
      GithubOpsRemoteSnapshot,
      GithubOpsIgnoreReason | "stale-operation",
      GithubOpsAdmission,
      GithubOpsOperationOutcome,
      GithubOpsRefusal
    >({
      actor,
      scope,
      ids: uuidIdSource,
      windowSessionId: scope.windowSessionId,
      snapshotInput: (input) => Object.freeze(structuredClone(input)),
      prepareIntent: ({ intent, observedRevision }) => ({
        intent,
        expected: observedRevision,
      }),
      fingerprint: (_identity, input) =>
        JSON.stringify({ appId, intent: input.intent }),
      selectOutcome: () => undefined,
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
        readonly reason: GithubOpsRefusal;
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

    return {
      request: (intent, observedRevision) =>
        completionAware.request({ intent, observedRevision }),
      sendAdmissionOnly: (intent, observedRevision) =>
        dispatchRemoteAdmissionOnly(actor, intent, observedRevision),
    };
  }, [actor, appId, scope]);
}
