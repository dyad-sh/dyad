import type { z } from "zod";
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

type ImageGenerationRendererIntent = z.infer<
  typeof ImageGenerationIntentEventSchema
>;

export const imageGenerationRemoteIntentContract = defineRemoteIntentContract<
  ImageGenerationKey,
  ImageGenerationRendererIntent,
  ImageGenerationEvent,
  ImageGenerationRemoteSnapshot
>({
  keyCodec: ImageGenerationKeySchema,
  encodeKey: (key) => key,
  rendererIntentCodec: ImageGenerationIntentEventSchema,
  snapshotCodec: ImageGenerationRemoteSnapshotSchema,
  toTrustedEvent: ({ intent, sender }) => {
    if (intent.type === "SUBMIT") {
      return Object.freeze({
        ...intent,
        job: Object.freeze({ ...intent.job }),
        initiatorWindowSessionId: sender.windowSessionId,
      }) satisfies ImageGenerationIntentEvent;
    }
    return Object.freeze({
      ...intent,
      activeInvocationRef: Object.freeze({
        ...intent.activeInvocationRef,
      }),
    }) satisfies ImageGenerationIntentEvent;
  },
  authorization: {
    subscribe: "public",
    dispatch: "required",
  },
  keyIntentRelationship: {
    kind: "validate",
    validate: (_key, intent) =>
      intent.type !== "CANCEL_REQUESTED" ||
      intent.activeInvocationRef.entityKey === intent.jobId,
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
  refusalMap: {
    ...PROTOCOL_V1_REFUSAL_MAP,
    keyIntentMismatch: "unauthorized",
  },
  budgets: {
    intentBytes: DEFAULT_REMOTE_INTENT_ENVELOPE_BYTES,
    snapshotBytes: DEFAULT_REMOTE_SNAPSHOT_ENVELOPE_BYTES,
  },
});
