import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import type { ImageGenerationJob } from "./imageGenerationAtoms";
import {
  chatImageGenerationJobsAtom,
  pendingImageGenerationsCountAtom,
  setImageGenerationJobsProjectionAtom,
} from "./imageGenerationAtoms";

const baseJob: ImageGenerationJob = {
  id: "job-1",
  prompt: "A lighthouse",
  themeMode: "plain",
  targetAppId: 1,
  targetAppName: "App",
  status: "success",
  startedAt: 1_000,
  source: "chat",
};

describe("image generation atoms", () => {
  it("excludes late-after-cancel successes from chat consumers", () => {
    const store = createStore();
    store.set(setImageGenerationJobsProjectionAtom, [
      baseJob,
      { ...baseJob, id: "job-2", lateAfterCancel: true },
    ]);

    expect(store.get(chatImageGenerationJobsAtom)).toEqual([baseJob]);
  });

  it("does not count cancellation requests as pending generations", () => {
    const store = createStore();
    store.set(setImageGenerationJobsProjectionAtom, [
      { ...baseJob, status: "pending" },
      { ...baseJob, id: "job-2", status: "cancelling" },
    ]);

    expect(store.get(pendingImageGenerationsCountAtom)).toBe(1);
  });
});
