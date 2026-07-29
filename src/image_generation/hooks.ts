import { useMemo } from "react";
import { useDistributedMachine } from "@/distributed_machines/react";
import { useRemoteMachineClient } from "@/distributed_machines/react";
import { createCompletionAwareActor } from "@/distributed_machines/request_actor";
import type { MachineDispatchReceipt } from "@/distributed_machines/remote_protocol";
import { RemoteMachineTransportError } from "@/distributed_machines/remote_client";
import type {
  PreparedDispatchResult,
  PreparedRequest,
} from "@/distributed_machines/prepared_request";
import type {
  RequestId,
  RequestIdempotencyKey,
  RequestMessageId,
} from "@/distributed_machines/request_identity";
import { ipc } from "@/ipc/types";
import {
  getImageGenerationKey,
  imageGenerationClientDefinition,
} from "./transport";
import type {
  CancelImageGenerationEvent,
  ImageGenerationJobView,
  ImageGenerationOperationOutcome,
  SubmitImageGenerationEvent,
} from "./state";
import {
  selectChatImageGenerationJobs,
  selectImageGenerationPendingCount,
} from "./selectors";
import { useImageGenerationRequestScope } from "./request_scope";
import type { ImageGenerationIgnoreReason } from "./state";
import type { ObservedRevisionToken } from "@/distributed_machines/remote_client";

const selectJobs = (snapshot: { jobs: readonly ImageGenerationJobView[] }) =>
  snapshot.jobs;

export function useImageGenerationActor() {
  return useDistributedMachine(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
    selectJobs,
  );
}

export type ImageGenerationAdmission =
  MachineDispatchReceipt<ImageGenerationIgnoreReason>;

export type ImageGenerationAdmissionRefusal =
  | Extract<ImageGenerationAdmission, { readonly kind: "rejected" }>["reason"]
  | ImageGenerationIgnoreReason;

export interface ImageGenerationRequestActor {
  request(
    intent: SubmitImageGenerationEvent,
    observedRevision?: ObservedRevisionToken,
  ): PreparedRequest<
    ImageGenerationAdmission,
    ImageGenerationOperationOutcome,
    ImageGenerationAdmissionRefusal
  >;
  cancel(
    intent: CancelImageGenerationEvent,
    owningRequestId: RequestId,
    observedRevision?: ObservedRevisionToken,
  ): PreparedRequest<
    ImageGenerationAdmission,
    ImageGenerationOperationOutcome,
    ImageGenerationAdmissionRefusal
  >;
}

export function useImageGenerationRequestActor(): ImageGenerationRequestActor {
  const client = useRemoteMachineClient();
  const scope = useImageGenerationRequestScope();
  const actor = client.actor<
    import("./transport").ImageGenerationKey,
    import("./transport").ImageGenerationRemoteSnapshot,
    import("./state").ImageGenerationIntentEvent,
    ImageGenerationIgnoreReason
  >(imageGenerationClientDefinition, getImageGenerationKey());
  return useMemo(() => {
    type RequestInput = {
      readonly intent: SubmitImageGenerationEvent;
      readonly observedRevision?: ObservedRevisionToken;
    };
    const completionAware = createCompletionAwareActor<
      RequestInput,
      ImageGenerationAdmission,
      ImageGenerationOperationOutcome,
      ImageGenerationAdmissionRefusal,
      Promise<ImageGenerationAdmission>
    >({
      scope,
      snapshotIntent: (input) => structuredClone(input),
      prepareIdentity: ({ intent }) => ({
        requestId: intent.requestId,
        messageId:
          `image-generation-message:${globalThis.crypto.randomUUID()}` as RequestMessageId,
        idempotencyKey:
          `image-generation-delivery:${globalThis.crypto.randomUUID()}` as RequestIdempotencyKey,
        windowSessionId: scope.windowSessionId,
      }),
      fingerprint: (_identity, input) => JSON.stringify(input.intent),
      retry: {
        kind: "stable-id",
        receiverDeduplication: "required",
      },
      classifyFailure: (error) =>
        error instanceof RemoteMachineTransportError
          ? {
              kind: "disconnect",
              retryable: true,
              admission: "unknown",
            }
          : { kind: "unexpected" },
      enqueue: () => {
        throw new Error(
          "Image generation exposes completion-aware request() only",
        );
      },
      dispatchRequest: async (
        identity,
        { intent, observedRevision },
      ): Promise<
        PreparedDispatchResult<
          ImageGenerationAdmission,
          ImageGenerationOperationOutcome,
          ImageGenerationAdmissionRefusal
        >
      > => {
        const lease = actor.retain();
        try {
          await lease.ready;
          const receipt = (await actor.dispatch(intent, {
            expected: observedRevision,
            messageId: identity.messageId,
            correlationId: identity.requestId,
          })) as ImageGenerationAdmission;
          if (receipt.kind === "rejected") {
            lease.release();
            return { kind: "refused", reason: receipt.reason };
          }
          const settled = ipc.imageGeneration
            .waitForOperation({ requestId: identity.requestId })
            .finally(() => lease.release());
          return {
            kind: "admitted",
            admission: receipt,
            disposition: "fresh",
            settled,
          };
        } catch (error) {
          lease.release();
          throw error;
        }
      },
    });
    type CancelRequestInput = {
      readonly intent: CancelImageGenerationEvent;
      readonly owningRequestId: RequestId;
      readonly observedRevision?: ObservedRevisionToken;
    };
    const cancellationActor = createCompletionAwareActor<
      CancelRequestInput,
      ImageGenerationAdmission,
      ImageGenerationOperationOutcome,
      ImageGenerationAdmissionRefusal,
      Promise<ImageGenerationAdmission>
    >({
      scope,
      snapshotIntent: (input) => structuredClone(input),
      prepareIdentity: () => ({
        requestId:
          `image-generation-cancel:${globalThis.crypto.randomUUID()}` as RequestId,
        messageId:
          `image-generation-cancel-message:${globalThis.crypto.randomUUID()}` as RequestMessageId,
        idempotencyKey:
          `image-generation-cancel-delivery:${globalThis.crypto.randomUUID()}` as RequestIdempotencyKey,
        windowSessionId: scope.windowSessionId,
      }),
      fingerprint: (_identity, input) => JSON.stringify(input),
      retry: { kind: "none" },
      classifyFailure: (error) =>
        error instanceof RemoteMachineTransportError
          ? {
              kind: "disconnect",
              retryable: false,
              admission: "unknown",
            }
          : { kind: "unexpected" },
      enqueue: () => {
        throw new Error("Image generation cancellation exposes request() only");
      },
      dispatchRequest: async (
        identity,
        { intent, owningRequestId, observedRevision },
      ) => {
        const lease = actor.retain();
        try {
          await lease.ready;
          const receipt = (await actor.dispatch(intent, {
            expected: observedRevision,
            messageId: identity.messageId,
            correlationId: identity.requestId,
            causationId: owningRequestId,
          })) as ImageGenerationAdmission;
          if (receipt.kind === "rejected") {
            lease.release();
            return { kind: "refused" as const, reason: receipt.reason };
          }
          const settled = ipc.imageGeneration
            .waitForOperation({ requestId: owningRequestId })
            .finally(() => lease.release());
          return {
            kind: "admitted" as const,
            admission: receipt,
            disposition: "fresh" as const,
            settled,
          };
        } catch (error) {
          lease.release();
          throw error;
        }
      },
    });
    return {
      request: (intent, observedRevision) =>
        completionAware.request({ intent, observedRevision }),
      cancel: (intent, owningRequestId, observedRevision) =>
        cancellationActor.request({
          intent,
          owningRequestId,
          observedRevision,
        }),
    };
  }, [actor, scope]);
}

export function useImageGenerationJobs(): readonly ImageGenerationJobView[] {
  return useImageGenerationActor().projection;
}

export function useChatImageGenerationJobs(): readonly ImageGenerationJobView[] {
  const remote = useDistributedMachine(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
    (snapshot) => selectChatImageGenerationJobs(snapshot.jobs),
  );
  return remote.projection;
}

export function useImageGenerationPendingCount(): number {
  const remote = useDistributedMachine(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
    (snapshot) => selectImageGenerationPendingCount(snapshot.jobs),
  );
  return remote.projection;
}
