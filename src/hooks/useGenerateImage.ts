import { useCallback } from "react";
import { useImageGenerationManager } from "@/image_generation/ImageGenerationProvider";
import type { StartImageGenerationParams } from "@/image_generation/state";

export function useGenerateImage() {
  const manager = useImageGenerationManager();
  const start = useCallback(
    (params: StartImageGenerationParams) => manager.submit(params),
    [manager],
  );
  const cancel = useCallback(
    (jobId: string) => manager.cancel(jobId),
    [manager],
  );
  return { start, cancel };
}
