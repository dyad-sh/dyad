import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  dismissImageGenerationToast,
  showImageGeneratingToast,
  showImageSuccessToast,
} from "@/components/ImageGenerationToast";
import { showError } from "@/lib/toast";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { createMachineProvider } from "@/state_machines/react";
import { createImageGenerationCommandRunner } from "./commands";
import { ImageGenerationManager } from "./manager";
import { type ImageGenerationJob } from "./state";
import { selectImageGenerationPendingCount } from "./selectors";

function useOwnedImageGenerationManager(): ImageGenerationManager {
  const queryClient = useQueryClient();
  const [manager] = useState(
    () =>
      new ImageGenerationManager({
        clock: systemClock,
        idSource: uuidIdSource,
        runner: createImageGenerationCommandRunner({ queryClient }),
      }),
  );
  return manager;
}

function useImageGenerationMount(manager: ImageGenerationManager): void {
  useEffect(() => {
    let previous: readonly ImageGenerationJob[] = manager.getJobsSnapshot();
    const orchestrate = () => {
      const next = manager.getJobsSnapshot();
      orchestrateToasts(previous, next, () =>
        selectImageGenerationPendingCount(manager.getJobsSnapshot()),
      );
      previous = next;
    };
    orchestrate();
    const unsubscribeToasts = manager.subscribeJobs(orchestrate);
    return () => {
      unsubscribeToasts();
      dismissImageGenerationToast();
    };
  }, [manager]);
}

const imageGenerationProvider = createMachineProvider({
  name: "ImageGeneration",
  useOwnedManager: useOwnedImageGenerationManager,
  useOnMount: useImageGenerationMount,
});

export const ImageGenerationProvider = imageGenerationProvider.Provider;
export const useImageGenerationManager = imageGenerationProvider.useManager;

function orchestrateToasts(
  previous: readonly ImageGenerationJob[],
  next: readonly ImageGenerationJob[],
  getPendingCount: () => number,
): void {
  const previousById = new Map(previous.map((job) => [job.id, job]));
  const settled = next.find((job) => {
    const prior = previousById.get(job.id);
    return (
      (prior?.status === "pending" || prior?.status === "cancelling") &&
      job.status !== "pending" &&
      job.status !== "cancelling"
    );
  });

  if (settled?.status === "success" && !settled.lateAfterCancel) {
    if (settled.result) showImageSuccessToast(settled.result, getPendingCount);
    return;
  }

  const pendingCount = getPendingCount();
  if (pendingCount > 0) showImageGeneratingToast(pendingCount);
  else dismissImageGenerationToast();

  if (settled?.status === "error") {
    showError(settled.error ?? "Image generation failed");
  }
}
