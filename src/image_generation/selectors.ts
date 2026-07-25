import type { ImageGenerationJob } from "./state";

const chatJobsCache = new WeakMap<
  readonly ImageGenerationJob[],
  readonly ImageGenerationJob[]
>();

export function selectChatImageGenerationJobs(
  jobs: readonly ImageGenerationJob[],
): readonly ImageGenerationJob[] {
  const cached = chatJobsCache.get(jobs);
  if (cached) return cached;
  const selected = jobs.filter(
    (job) => job.source === "chat" && !job.lateAfterCancel,
  );
  chatJobsCache.set(jobs, selected);
  return selected;
}

export function selectImageGenerationPendingCount(
  jobs: readonly ImageGenerationJob[],
): number {
  return jobs.filter((job) => job.status === "pending").length;
}
