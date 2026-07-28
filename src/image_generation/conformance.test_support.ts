import {
  defineMachineConformance,
  defineVariantInventory,
} from "@/distributed_machines/testing/machine_conformance";
import type { ImageGenerationEvent, ImageGenerationStatus } from "./state";

const imageGenerationStateVariants = defineVariantInventory<
  ImageGenerationStatus | "empty"
>()(["empty", "pending", "cancelling", "success", "error", "cancelled"]);

const imageGenerationEventVariants = defineVariantInventory<
  ImageGenerationEvent["type"]
>()([
  "SUBMIT",
  "CANCEL_REQUESTED",
  "JOB_SUCCEEDED",
  "JOB_FAILED",
  "CANCEL_CONFIRMED",
  "PRUNE_JOB",
  "APP_DELETED",
]);

export const imageGenerationConformance = defineMachineConformance({
  machineId: "image_generation",
  stateVariants: imageGenerationStateVariants,
  eventVariants: imageGenerationEventVariants,
  tiers: ["T0", "T1", "T2"],
  exclusions: [
    {
      tier: "T3",
      reason:
        "Image-generation jobs intentionally remain in-memory in the current runtime.",
    },
    {
      tier: "T4",
      reason: "Cross-machine composition is outside the PR2 conformance shell.",
    },
  ],
  invariants: [
    {
      id: "unique-job-and-operation-identities",
      description: "Live jobs have unique job IDs and operation IDs.",
    },
    {
      id: "cancel-targets-active-invocation",
      description: "Cancellation targets the job's exact active invocation.",
    },
    {
      id: "terminal-jobs-own-no-invocation",
      description: "Terminal jobs clear active invocation ownership.",
    },
    {
      id: "authoritative-ui-admission",
      description:
        "Renderer input and presentation remain unchanged until authoritative admission.",
    },
  ],
  representativeCapabilities: {
    canSubmit: ["submit"],
    canCancel: ["cancel"],
  },
  representativeIntents: {
    submit: {
      event: "SUBMIT",
      create: () => ({
        type: "SUBMIT",
        operationId: "generate-request",
        job: {
          id: "job",
          prompt: "representative prompt",
          themeMode: "plain",
          targetAppId: 1,
          targetAppName: "App",
          startedAt: 1,
        },
      }),
    },
    cancel: {
      event: "CANCEL_REQUESTED",
      create: () => ({
        type: "CANCEL_REQUESTED",
        jobId: "job",
        activeInvocationRef: {
          kind: "image-generation",
          entityKey: "job",
          operationId: "generate-request",
        },
      }),
    },
  },
  historicalFailureShapes: [
    "post-authorization-actor-window-change",
    "unresolved-receipt-under-pressure",
    "disposal-with-unresolved-work",
    "ingress-through-deletion-fence",
    "late-producer-actor-recreation",
    "ui-mutation-before-authoritative-admission",
    "same-id-payload-conflict",
    "delivery-projection-divergence",
    "error-classification-collapse",
    "abort-terminal-settlement",
  ],
});
