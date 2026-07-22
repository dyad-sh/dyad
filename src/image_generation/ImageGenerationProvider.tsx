import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
import { useManagerLifecycle } from "@/state_machines/react";
import { createImageGenerationCommandRunner } from "./commands";
import { ImageGenerationManager } from "./manager";

const ImageGenerationContext = createContext<ImageGenerationManager | null>(
  null,
);

export function ImageGenerationProvider({
  children,
  manager: providedManager,
}: {
  children: ReactNode;
  manager?: ImageGenerationManager;
}) {
  if (providedManager) {
    return (
      <ProvidedImageGenerationProvider manager={providedManager}>
        {children}
      </ProvidedImageGenerationProvider>
    );
  }
  return (
    <OwnedImageGenerationProvider>{children}</OwnedImageGenerationProvider>
  );
}

function OwnedImageGenerationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [manager] = useState(
    () =>
      new ImageGenerationManager({
        clock: systemClock,
        idSource: uuidIdSource,
        runner: createImageGenerationCommandRunner({ queryClient }),
      }),
  );
  return (
    <ProvidedImageGenerationProvider manager={manager}>
      {children}
    </ProvidedImageGenerationProvider>
  );
}

function ProvidedImageGenerationProvider({
  children,
  manager,
}: {
  children: ReactNode;
  manager: ImageGenerationManager;
}) {
  const store = useStore();
  useManagerLifecycle(manager);

  useEffect(() => {
    let previous: ImageGenerationJob[] = [];
    const project = () => {
      const next = manager.getProjection();
      store.set(setImageGenerationJobsProjectionAtom, next);
      orchestrateToasts(
        previous,
        next,
        store.get(pendingImageGenerationsCountAtom),
      );
      previous = next;
    };
    project();
    const unsubscribe = manager.subscribeProjection(project);
    return () => {
      unsubscribe();
      store.set(setImageGenerationJobsProjectionAtom, []);
      dismissImageGenerationToast();
    };
  }, [manager, store]);

  return (
    <ImageGenerationContext.Provider value={manager}>
      {children}
    </ImageGenerationContext.Provider>
  );
}

function orchestrateToasts(
  previous: ImageGenerationJob[],
  next: ImageGenerationJob[],
  pendingCount: number,
): void {
  const previousById = new Map(previous.map((job) => [job.id, job]));
  const settled = next.find((job) => {
    const prior = previousById.get(job.id);
    return prior?.status === "pending" && job.status !== "pending";
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

export function useImageGenerationManager(): ImageGenerationManager {
  const manager = useContext(ImageGenerationContext);
  if (!manager) {
    throw new Error(
      "useImageGenerationManager requires ImageGenerationProvider",
    );
  }
  return manager;
}
