import { useCallback } from "react";
import { showError } from "@/lib/toast";
import { useImageGenerationActor } from "@/image_generation/hooks";
import type { StartImageGenerationParams } from "@/image_generation/state";

export function useGenerateImage() {
  const remote = useImageGenerationActor();
  const start = useCallback(
    (params: StartImageGenerationParams) => {
      const jobId = `image-generation-job:${globalThis.crypto.randomUUID()}`;
      void remote
        .dispatch({
          type: "SUBMIT",
          job: {
            ...params,
            id: jobId,
            startedAt: Date.now(),
          },
          operationId: `image-generation-operation:${globalThis.crypto.randomUUID()}`,
        })
        .then(
          (receipt) => {
            if (receipt.kind !== "applied") {
              showError(
                "Image generation is temporarily unavailable. Please try again.",
              );
            }
          },
          () =>
            showError(
              "Image generation is temporarily unavailable. Please try again.",
            ),
        );
      return jobId;
    },
    [remote.dispatch],
  );
  const cancel = useCallback(
    (jobId: string) => {
      const job = remote.state.jobs.find((candidate) => candidate.id === jobId);
      if (!job?.activeInvocationRef) return;
      void remote
        .dispatch({
          type: "CANCEL_REQUESTED",
          jobId,
          activeInvocationRef: job.activeInvocationRef,
        })
        .then(
          (receipt) => {
            if (receipt.kind !== "applied") {
              showError("Could not cancel image generation. Please try again.");
            }
          },
          () =>
            showError("Could not cancel image generation. Please try again."),
        );
    },
    [remote.dispatch, remote.state.jobs],
  );
  return { start, cancel };
}
