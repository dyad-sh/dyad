import { useCallback, useRef } from "react";
import { useMachineMutation } from "@/distributed_machines/use_machine_mutation";
import type { RequestId } from "@/distributed_machines/request_identity";
import { showError } from "@/lib/toast";
import {
  useImageGenerationActor,
  useImageGenerationRequestActor,
} from "@/image_generation/hooks";
import type {
  ImageGenerationJobView,
  ImageGenerationOperationOutcome,
  StartImageGenerationParams,
} from "@/image_generation/state";
import type { PreparedRequest } from "@/distributed_machines/prepared_request";
import type {
  ImageGenerationAdmission,
  ImageGenerationAdmissionRefusal,
} from "@/image_generation/hooks";

interface StartMutationInput {
  readonly params: StartImageGenerationParams;
  readonly jobId: string;
  readonly requestId: RequestId;
  readonly operationId: string;
}

type ImagePreparedRequest = PreparedRequest<
  ImageGenerationAdmission,
  ImageGenerationOperationOutcome,
  ImageGenerationAdmissionRefusal
>;

function classifyOutcome(outcome: ImageGenerationOperationOutcome) {
  switch (outcome.kind) {
    case "succeeded":
      return { kind: "succeeded" as const };
    case "cancelled":
    case "disposed":
      return { kind: "cancelled" as const };
    case "failed":
    case "rejected":
      return { kind: "failed" as const, error: outcome };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function useGenerateImage() {
  const remote = useImageGenerationActor();
  const requestActor = useImageGenerationRequestActor();
  const latestStart = useRef<ImagePreparedRequest | undefined>(undefined);
  const latestCancellation = useRef<ImagePreparedRequest | undefined>(
    undefined,
  );

  const startMutation = useMachineMutation({
    connection: remote.connection,
    snapshot: remote.snapshot,
    request: (input: StartMutationInput, observedRevision) => {
      const prepared = requestActor.request(
        {
          type: "SUBMIT",
          job: {
            ...input.params,
            id: input.jobId,
            startedAt: Date.now(),
          },
          requestId: input.requestId,
          operationId: input.operationId,
        },
        observedRevision,
      );
      latestStart.current = prepared;
      return prepared;
    },
    classifyOutcome,
  });

  const cancelMutation = useMachineMutation({
    connection: remote.connection,
    snapshot: remote.snapshot,
    request: (job: ImageGenerationJobView, observedRevision) => {
      if (!job.activeInvocationRef) {
        throw new Error("Image generation is no longer cancellable");
      }
      const prepared = requestActor.cancel(
        {
          type: "CANCEL_REQUESTED",
          jobId: job.id,
          activeInvocationRef: job.activeInvocationRef,
        },
        job.requestId,
        observedRevision,
      );
      latestCancellation.current = prepared;
      return prepared;
    },
    classifyOutcome,
  });

  const start = useCallback(
    async (params: StartImageGenerationParams): Promise<string | null> => {
      const input: StartMutationInput = {
        jobId: `image-generation-job:${globalThis.crypto.randomUUID()}`,
        requestId:
          `image-generation-request:${globalThis.crypto.randomUUID()}` as RequestId,
        operationId: `image-generation-runtime:${globalThis.crypto.randomUUID()}`,
        params,
      };
      const settlement = startMutation.mutate(input);
      const prepared = latestStart.current;
      if (!prepared)
        throw new Error("Image generation request was not prepared");
      void settlement.catch(() => undefined);
      try {
        const admission = await prepared.admission;
        if (admission.kind === "admitted") return input.jobId;
        prepared.detach();
      } catch {
        prepared.detach();
        // The existing failure presentation below covers unexpected admission.
      }
      showError(
        "Image generation is temporarily unavailable. Please try again.",
      );
      return null;
    },
    [startMutation.mutate],
  );

  const cancel = useCallback(
    (jobId: string) => {
      const job = remote.state.jobs.find((candidate) => candidate.id === jobId);
      if (!job?.activeInvocationRef) return;
      const settlement = cancelMutation.mutate(job);
      const prepared = latestCancellation.current;
      void settlement.catch(() => undefined);
      void (async () => {
        try {
          if (!prepared) {
            throw new Error("Image cancellation request was not prepared");
          }
          const admission = await prepared.admission;
          if (admission.kind !== "admitted") {
            prepared?.detach();
            showError("Could not cancel image generation. Please try again.");
            return;
          }
          await settlement;
        } catch {
          prepared?.detach();
          showError("Could not cancel image generation. Please try again.");
        }
      })();
    },
    [cancelMutation.mutate, remote.state.jobs],
  );
  return { start, cancel };
}
