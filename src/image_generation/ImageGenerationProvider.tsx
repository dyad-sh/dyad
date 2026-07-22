import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import {
  pendingImageGenerationsCountAtom,
  setImageGenerationJobsProjectionAtom,
  type ImageGenerationJob,
} from "@/atoms/imageGenerationAtoms";
import {
  dismissImageGenerationToast,
  showImageGeneratingToast,
  showImageSuccessToast,
} from "@/components/ImageGenerationToast";
import { showError } from "@/lib/toast";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { projectToAtom } from "@/state_machines/projection";
import { createMachineProvider } from "@/state_machines/react";
import { createImageGenerationCommandRunner } from "./commands";
import { ImageGenerationManager } from "./manager";

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
  const store = useStore();
  useEffect(() => {
    const stopProjection = projectToAtom(
      store,
      setImageGenerationJobsProjectionAtom,
      {
        getSnapshot: manager.getProjection,
        subscribe: manager.subscribeProjection,
      },
      (jobs) => jobs,
      { cleanupValue: [] },
    );
    let previous: ImageGenerationJob[] = manager.getProjection();
    const orchestrate = () => {
      const next = manager.getProjection();
      orchestrateToasts(
        previous,
        next,
        store.get(pendingImageGenerationsCountAtom),
      );
      previous = next;
    };
    orchestrate();
    const unsubscribeToasts = manager.subscribeProjection(orchestrate);
    return () => {
      unsubscribeToasts();
      stopProjection();
      dismissImageGenerationToast();
    };
  }, [manager, store]);
}

const imageGenerationProvider = createMachineProvider({
  name: "ImageGeneration",
  useOwnedManager: useOwnedImageGenerationManager,
  useOnMount: useImageGenerationMount,
});

export const ImageGenerationProvider = imageGenerationProvider.Provider;
export const useImageGenerationManager = imageGenerationProvider.useManager;

function orchestrateToasts(
  previous: ImageGenerationJob[],
  next: ImageGenerationJob[],
  pendingCount: number,
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
    if (settled.result) showImageSuccessToast(settled.result);
    return;
  }

  if (pendingCount > 0) showImageGeneratingToast(pendingCount);
  else dismissImageGenerationToast();

  if (settled?.status === "error") {
    showError(settled.error ?? "Image generation failed");
  }
}
