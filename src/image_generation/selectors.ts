import type { ImageGenerationJobView } from "./state";

const chatJobsCache = new WeakMap<
  readonly ImageGenerationJobView[],
  readonly ImageGenerationJobView[]
>();

export function selectChatImageGenerationJobs(
  jobs: readonly ImageGenerationJobView[],
): readonly ImageGenerationJobView[] {
  const cached = chatJobsCache.get(jobs);
  if (cached) return cached;
  const selected = jobs.filter(
    (job) => job.source === "chat" && !job.lateAfterCancel,
  );
  chatJobsCache.set(jobs, selected);
  return selected;
}

export function selectImageGenerationPendingCount(
  jobs: readonly ImageGenerationJobView[],
): number {
  return jobs.filter((job) => job.status === "pending").length;
}
