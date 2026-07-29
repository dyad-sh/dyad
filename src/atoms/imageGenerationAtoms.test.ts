import { describe, expect, it } from "vitest";
import type { ImageGenerationJobView } from "@/image_generation/state";
import {
  selectChatImageGenerationJobs,
  selectImageGenerationPendingCount,
} from "@/image_generation/selectors";
import type { RequestId } from "@/distributed_machines/request_identity";

const baseJob: ImageGenerationJobView = {
  id: "job-1",
  requestId: "request-1" as RequestId,
  prompt: "A lighthouse",
  themeMode: "plain",
  targetAppId: 1,
  targetAppName: "App",
  status: "success",
  startedAt: 1_000,
  source: "chat",
  activeInvocationRef: null,
};

describe("image generation selectors", () => {
  it("excludes late-after-cancel successes from chat consumers", () => {
    const jobs = [baseJob, { ...baseJob, id: "job-2", lateAfterCancel: true }];

    const selected = selectChatImageGenerationJobs(jobs);
    expect(selected).toEqual([baseJob]);
    expect(selectChatImageGenerationJobs(jobs)).toBe(selected);
  });

  it("does not count cancellation requests as pending generations", () => {
    const jobs: ImageGenerationJobView[] = [
      { ...baseJob, status: "pending" },
      { ...baseJob, id: "job-2", status: "cancelling" },
    ];

    expect(selectImageGenerationPendingCount(jobs)).toBe(1);
  });
});
