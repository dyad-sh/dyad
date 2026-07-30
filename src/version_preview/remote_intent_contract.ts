import {
  DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
  DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  PROTOCOL_V1_REFUSAL_MAP,
  defineRemoteIntentContract,
} from "@/distributed_machines/remote_intent_contract";
import { DEFAULT_REMOTE_OPERATION_OUTCOME_ENVELOPE_BYTES } from "@/distributed_machines/remote_protocol";
import {
  VersionPreviewIntentEventSchema,
  VersionPreviewInvocationRefSchema,
  VersionPreviewKeySchema,
  VersionPreviewRemoteSnapshotSchema,
  type VersionPreviewActorEvent,
  type VersionPreviewIntentEvent,
  type VersionPreviewKey,
  type VersionPreviewRemoteSnapshot,
} from "./transport";
import { VersionPreviewOperationOutcomeSchema } from "./operations";

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

export const versionPreviewRemoteIntentContract = defineRemoteIntentContract<
  VersionPreviewKey,
  VersionPreviewIntentEvent,
  VersionPreviewActorEvent,
  VersionPreviewRemoteSnapshot
>({
  keyCodec: VersionPreviewKeySchema,
  encodeKey: (key) => key,
  rendererIntentCodec: VersionPreviewIntentEventSchema,
  snapshotCodec: VersionPreviewRemoteSnapshotSchema,
  operationOutcome: {
    maxEnvelopeBytes: DEFAULT_REMOTE_OPERATION_OUTCOME_ENVELOPE_BYTES,
    invocationRefCodec: VersionPreviewInvocationRefSchema,
    outcomeCodec: VersionPreviewOperationOutcomeSchema,
  },
  toTrustedEvent: ({ intent, sender, requestIdentity }) =>
    Object.freeze({
      ...structuredClone(intent),
      windowSessionId: sender.windowSessionId,
      ...(requestIdentity ? { requestId: requestIdentity.requestId } : {}),
    }) as VersionPreviewActorEvent,
  authorization: {
    subscribe: "required",
    dispatch: "required",
  },
  keyIntentRelationship: { kind: "entity-relative" },
  intents: {
    ACQUIRE_WINDOW_INTEREST: {
      completion: "admission-only",
      observedRevision: { kind: "none" },
      retry: { kind: "none" },
      acceptance: "admission",
      inputDisposition: "preserve",
    },
    RESTORE_WINDOW_INTEREST: {
      completion: "admission-only",
      observedRevision: { kind: "none" },
      retry: { kind: "none" },
      acceptance: "admission",
      inputDisposition: "preserve",
    },
    RELEASE_WINDOW_INTEREST: {
      completion: "admission-only",
      observedRevision: { kind: "none" },
      retry: { kind: "none" },
      acceptance: "admission",
      inputDisposition: "preserve",
    },
    CLOSE: trackedMutation,
    APP_CHANGED: trackedMutation,
    SELECT_VERSION: trackedMutation,
    SWITCH_BRANCH: trackedMutation,
    RESTORE: trackedMutation,
    RESTORE_TO_MESSAGE: trackedMutation,
    RETRY_RETURN: trackedMutation,
  },
  refusalMap: PROTOCOL_V1_REFUSAL_MAP,
  budgets: {
    intentBytes: DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
    snapshotBytes: DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  },
});
