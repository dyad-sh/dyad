import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findLanguageModel: vi.fn(),
  readSettings: vi.fn(),
  resolveAutoModelForSettings: vi.fn(),
}));

vi.mock("@/ipc/utils/findLanguageModel", () => ({
  findLanguageModel: mocks.findLanguageModel,
}));

vi.mock("@/ipc/utils/auto_model_utils", () => ({
  resolveAutoModelForSettings: mocks.resolveAutoModelForSettings,
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

import {
  getCompactionThreshold,
  getCompactionThresholdForSelectedModel,
} from "@/ipc/utils/token_utils";

describe("token_utils compaction threshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses explicit compaction window when one is provided", () => {
    expect(
      getCompactionThreshold({
        contextWindow: 200_000,
        compactionWindow: 50_000,
      }),
    ).toBe(50_000);
  });

  it("keeps existing threshold behavior without an explicit compaction window", () => {
    expect(getCompactionThreshold({ contextWindow: 200_000 })).toBe(160_000);
    expect(getCompactionThreshold({ contextWindow: 400_000 })).toBe(180_000);
  });

  it("uses the routed auto model compaction window when one is available", async () => {
    const selectedModel = { provider: "auto", name: "auto" };
    const routedModel = { provider: "anthropic", name: "claude-sonnet-4-6" };
    mocks.readSettings.mockReturnValue({
      selectedModel,
      providerSettings: {
        anthropic: { apiKey: { value: "test-key" } },
      },
    });
    mocks.resolveAutoModelForSettings.mockResolvedValue(routedModel);
    mocks.findLanguageModel.mockResolvedValue({
      apiName: routedModel.name,
      contextWindow: 1_000_000,
      compactionWindow: 50_000,
    });

    await expect(getCompactionThresholdForSelectedModel()).resolves.toBe(
      50_000,
    );
    expect(mocks.findLanguageModel).toHaveBeenCalledWith(routedModel);
  });

  it("falls back to the routed auto model context window without a compaction window", async () => {
    const selectedModel = { provider: "auto", name: "auto" };
    const routedModel = { provider: "google", name: "gemini-3-flash-preview" };
    mocks.readSettings.mockReturnValue({
      selectedModel,
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });
    mocks.resolveAutoModelForSettings.mockResolvedValue(routedModel);
    mocks.findLanguageModel.mockResolvedValue({
      apiName: routedModel.name,
      contextWindow: 128_000,
    });

    await expect(getCompactionThresholdForSelectedModel()).resolves.toBe(
      102_400,
    );
    expect(mocks.findLanguageModel).toHaveBeenCalledWith(routedModel);
  });

  it("uses a specific non-auto model compaction window", async () => {
    const selectedModel = { provider: "openai", name: "gpt-5.2" };
    mocks.readSettings.mockReturnValue({ selectedModel });
    mocks.findLanguageModel.mockResolvedValue({
      apiName: selectedModel.name,
      contextWindow: 400_000,
      compactionWindow: 40_000,
    });

    await expect(getCompactionThresholdForSelectedModel()).resolves.toBe(
      40_000,
    );
    expect(mocks.resolveAutoModelForSettings).not.toHaveBeenCalled();
    expect(mocks.findLanguageModel).toHaveBeenCalledWith(selectedModel);
  });
});
