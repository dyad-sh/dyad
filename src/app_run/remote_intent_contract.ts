import {
  DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
  DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  PROTOCOL_V1_REFUSAL_MAP,
  defineRemoteIntentContract,
} from "@/distributed_machines/remote_intent_contract";
import type { AppRunWireEvent } from "./transport";
import {
  AppRunIntentEventSchema,
  AppRunKeySchema,
  AppRunRemoteSnapshotSchema,
  type AppRunIntentEvent,
  type AppRunKey,
  type AppRunRemoteSnapshot,
} from "./transport";

const trackedAtAdmission = {
  completion: "tracked-completion",
  observedRevision: { kind: "none" },
  retry: { kind: "none" },
  acceptance: "admission",
  inputDisposition: "preserve-until-accepted",
} as const;

export const appRunRemoteIntentContract = defineRemoteIntentContract<
  AppRunKey,
  AppRunIntentEvent,
  AppRunWireEvent,
  AppRunRemoteSnapshot
>({
  keyCodec: AppRunKeySchema,
  encodeKey: (key) => key,
  rendererIntentCodec: AppRunIntentEventSchema,
  snapshotCodec: AppRunRemoteSnapshotSchema,
  toTrustedEvent: ({ intent }) => Object.freeze(structuredClone(intent)),
  authorization: {
    subscribe: "required",
    dispatch: "required",
  },
  keyIntentRelationship: {
    kind: "validate",
    validate: (key, intent) =>
      intent.type !== "STOP_REQUESTED" ||
      intent.activeInvocationRef.entityKey === key.appId,
  },
  intents: {
    START: {
      ...trackedAtAdmission,
      observedRevision: { kind: "actor", required: true },
    },
    RESTART: {
      ...trackedAtAdmission,
      observedRevision: { kind: "actor", required: true },
    },
    STOP_REQUESTED: trackedAtAdmission,
    MANUAL_RELOAD: {
      completion: "admission-only",
      observedRevision: { kind: "none" },
      retry: { kind: "none" },
      acceptance: "admission",
      inputDisposition: "preserve",
    },
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
