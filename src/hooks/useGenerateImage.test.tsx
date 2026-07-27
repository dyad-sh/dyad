import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerateImage } from "./useGenerateImage";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/image_generation/hooks", () => ({
  useImageGenerationActor: () => ({
    dispatch: mocks.dispatch,
    state: { jobs: [] },
  }),
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

const params = {
  prompt: "A lighthouse",
  themeMode: "plain" as const,
  targetAppId: 7,
  targetAppName: "App",
};

describe("useGenerateImage", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.showError.mockReset();
  });

  it("returns a job ID only after submit admission is applied", async () => {
    mocks.dispatch.mockResolvedValue({ kind: "applied" });
    const { result } = renderHook(() => useGenerateImage());

    let jobId: string | null = null;
    await act(async () => {
      jobId = await result.current.start(params);
    });

    expect(jobId).toMatch(/^image-generation-job:/);
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("reports rejected admission without returning a started job", async () => {
    mocks.dispatch.mockResolvedValue({
      kind: "rejected",
      reason: "stale-actor",
    });
    const { result } = renderHook(() => useGenerateImage());

    let jobId: string | null = "not-set";
    await act(async () => {
      jobId = await result.current.start(params);
    });

    expect(jobId).toBeNull();
    expect(mocks.showError).toHaveBeenCalledOnce();
  });
});
