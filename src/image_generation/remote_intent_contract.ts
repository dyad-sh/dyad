import {
  DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
  DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  PROTOCOL_V1_REFUSAL_MAP,
  defineRemoteIntentContract,
} from "@/distributed_machines/remote_intent_contract";
import type { ImageGenerationEvent } from "./state";
import {
  ImageGenerationIntentEventSchema,
  ImageGenerationKeySchema,
  ImageGenerationRemoteSnapshotSchema,
  type ImageGenerationKey,
  type ImageGenerationRemoteSnapshot,
} from "./transport";
import type { ImageGenerationIntentEvent } from "./state";

export const imageGenerationRemoteIntentContract = defineRemoteIntentContract<
  ImageGenerationKey,
  ImageGenerationIntentEvent,
  ImageGenerationEvent,
  ImageGenerationRemoteSnapshot
>({
  keyCodec: ImageGenerationKeySchema,
  encodeKey: (key) => key,
  rendererIntentCodec: ImageGenerationIntentEventSchema,
  snapshotCodec: ImageGenerationRemoteSnapshotSchema,
  toTrustedEvent: (intent) => intent,
  authorization: {
    subscribe: "public",
    dispatch: "required",
  },
  keyIntentRelationship: {
    kind: "validate",
    validate: (_key, intent) =>
      intent.type !== "CANCEL_REQUESTED" ||
      intent.activeInvocationRef.entityKey === intent.jobId,
    mismatchRefusal: "invalid-intent",
  },
  intents: {
    SUBMIT: {
      completion: "tracked-completion",
      observedRevision: { kind: "none" },
      retry: {
        kind: "stable-id",
        identity: "domain",
        receiverDeduplication: "required",
        lifetime: "window-session",
      },
      acceptance: "admission",
      inputDisposition: "preserve-until-accepted",
    },
    CANCEL_REQUESTED: {
      completion: "tracked-completion",
      observedRevision: { kind: "none" },
      retry: { kind: "none" },
      acceptance: "admission",
      inputDisposition: "preserve",
    },
  },
  refusalMap: PROTOCOL_V1_REFUSAL_MAP,
  budgets: {
    intentBytes: DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
    snapshotBytes: DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  },
});
