import { useDistributedMachine } from "@/distributed_machines/react";
import {
  getImageGenerationKey,
  imageGenerationClientDefinition,
} from "./transport";
import type { ImageGenerationJobView } from "./state";
import {
  selectChatImageGenerationJobs,
  selectImageGenerationPendingCount,
} from "./selectors";

const selectJobs = (snapshot: { jobs: readonly ImageGenerationJobView[] }) =>
  snapshot.jobs;

export function useImageGenerationActor() {
  return useDistributedMachine(
    imageGenerationClientDefinition,
    getImageGenerationKey(),
    selectJobs,
  );
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
