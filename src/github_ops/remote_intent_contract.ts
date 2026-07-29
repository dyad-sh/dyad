import { DEFAULT_REMOTE_OPERATION_OUTCOME_ENVELOPE_BYTES } from "@/distributed_machines/remote_protocol";
import {
  DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
  DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  PROTOCOL_V1_REFUSAL_MAP,
  defineRemoteIntentContract,
} from "@/distributed_machines/remote_intent_contract";
import {
  GithubOpsIntentEventSchema,
  GithubOpsInvocationRefSchema,
  GithubOpsKeySchema,
  GithubOpsOperationOutcomeSchema,
  GithubOpsRemoteSnapshotSchema,
  type GithubOpsIntentEvent,
  type GithubOpsKey,
  type GithubOpsRemoteSnapshot,
  type GithubOpsTrustedIntentEvent,
  type GithubOpsWireEvent,
} from "./transport";

const trackedMutation = {
  completion: "tracked-completion",
  observedRevision: { kind: "actor", required: true },
  retry: {
    kind: "stable-id",
    identity: "request",
    receiverDeduplication: "required",
    lifetime: "window-session",
  },
  acceptance: "admission",
  inputDisposition: "preserve-until-completed",
} as const;

const admissionOnlyStateSensitive = {
  completion: "admission-only",
  observedRevision: { kind: "actor", required: true },
  retry: { kind: "none" },
  acceptance: "admission",
  inputDisposition: "preserve",
} as const;

const admissionOnlyObservational = {
  ...admissionOnlyStateSensitive,
  observedRevision: { kind: "none" },
} as const;

export const githubOpsRemoteIntentContract = defineRemoteIntentContract<
  GithubOpsKey,
  GithubOpsIntentEvent,
  GithubOpsWireEvent,
  GithubOpsRemoteSnapshot
>({
  keyCodec: GithubOpsKeySchema,
  encodeKey: (key) => key,
  rendererIntentCodec: GithubOpsIntentEventSchema,
  snapshotCodec: GithubOpsRemoteSnapshotSchema,
  operationOutcome: {
    maxEnvelopeBytes: DEFAULT_REMOTE_OPERATION_OUTCOME_ENVELOPE_BYTES,
    invocationRefCodec: GithubOpsInvocationRefSchema,
    outcomeCodec: GithubOpsOperationOutcomeSchema,
  },
  toTrustedEvent: ({ intent, sender, requestIdentity }) => {
    if (
      intent.type === "OP_REQUESTED" ||
      intent.type === "ABORT_AND_SWITCH_CONFIRMED"
    ) {
      if (!requestIdentity) {
        throw new Error(
          `Tracked GitHub intent ${intent.type} requires request identity`,
        );
      }
      return Object.freeze({
        ...structuredClone(intent),
        operationId: `github-operation-request:${requestIdentity.requestId}`,
        requestId: requestIdentity.requestId,
        initiatorWindowSessionId: sender.windowSessionId,
      }) satisfies GithubOpsTrustedIntentEvent;
    }
    return Object.freeze(
      structuredClone(intent),
    ) satisfies GithubOpsTrustedIntentEvent;
  },
  authorization: {
    subscribe: "required",
    dispatch: "required",
  },
  keyIntentRelationship: {
    kind: "validate",
    validate: (key, intent) =>
      intent.type !== "OP_REQUESTED" ||
      !intent.activeInvocationRef ||
      intent.activeInvocationRef.entityKey === key.appId,
  },
  intents: {
    OP_REQUESTED: trackedMutation,
    ABORT_AND_SWITCH_CONFIRMED: trackedMutation,
    BLOCKED_DISMISSED: admissionOnlyStateSensitive,
    RESOLVE_WITH_AI_STARTED: admissionOnlyStateSensitive,
    BANNER_DISMISSED: admissionOnlyObservational,
    RECONCILE_REQUESTED: admissionOnlyObservational,
    CONFLICT_RESOLUTION_STARTED: admissionOnlyObservational,
    CONFLICT_RESOLUTION_CANCELLED: admissionOnlyObservational,
  },
  refusalMap: {
    ...PROTOCOL_V1_REFUSAL_MAP,
    keyIntentMismatch: "unauthorized",
  },
  budgets: {
    intentBytes: DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
    snapshotBytes: DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  },
});
