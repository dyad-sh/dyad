import { useSyncExternalStore } from "react";
import type { ImageGenerationJob } from "./state";
import { useImageGenerationManager } from "./ImageGenerationProvider";
import {
  selectChatImageGenerationJobs,
  selectImageGenerationPendingCount,
} from "./selectors";

export function useImageGenerationJobs(): readonly ImageGenerationJob[] {
  const manager = useImageGenerationManager();
  return useSyncExternalStore(manager.subscribeJobs, manager.getJobsSnapshot);
}

export function useChatImageGenerationJobs(): readonly ImageGenerationJob[] {
  const manager = useImageGenerationManager();
  return useSyncExternalStore(manager.subscribeJobs, () =>
    selectChatImageGenerationJobs(manager.getJobsSnapshot()),
  );
}

export function useImageGenerationPendingCount(): number {
  const manager = useImageGenerationManager();
  return useSyncExternalStore(manager.subscribeJobs, () =>
    selectImageGenerationPendingCount(manager.getJobsSnapshot()),
  );
}
