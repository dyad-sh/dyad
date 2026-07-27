import { describe, expect, it, vi } from "vitest";

import {
  getCompactionThreshold,
  getTemperature,
  shouldTriggerCompaction,
  supportsVision,
} from "@/ipc/utils/token_utils";
import { findLanguageModel } from "@/ipc/utils/findLanguageModel";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

vi.mock("@/ipc/utils/findLanguageModel", () => ({
  findLanguageModel: vi.fn(),
}));

const mockFindLanguageModel = vi.mocked(findLanguageModel);

describe("getTemperature", () => {
  it("does not set a default temperature for models without metadata", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
    });

    await expect(
      getTemperature({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBeUndefined();
  });

  it("uses configured model temperature metadata", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
      temperature: 0.7,
    });

    await expect(
      getTemperature({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBe(0.7);
  });
});

describe("getCompactionThreshold", () => {
  describe("non-google providers", () => {
    it("uses the 250k cap for large context windows", () => {
      expect(getCompactionThreshold(400_000, "openai")).toBe(250_000);
      expect(getCompactionThreshold(1_000_000, "anthropic")).toBe(250_000);
    });

    it("falls back to contextWindow - 25k when the cap is higher", () => {
      expect(getCompactionThreshold(200_000, "openai")).toBe(175_000);
      expect(getCompactionThreshold(128_000, "anthropic")).toBe(103_000);
    });

    it("treats unknown providers like non-google providers", () => {
      expect(getCompactionThreshold(400_000, "vertex")).toBe(250_000);
      expect(getCompactionThreshold(400_000, "openrouter")).toBe(250_000);
    });
  });

  describe("google provider", () => {
    it("uses the 190k cap for large context windows", () => {
      expect(getCompactionThreshold(1_000_000, "google")).toBe(190_000);
      expect(getCompactionThreshold(400_000, "google")).toBe(190_000);
    });

    it("falls back to contextWindow - 25k when the cap is higher", () => {
      expect(getCompactionThreshold(200_000, "google")).toBe(175_000);
      expect(getCompactionThreshold(128_000, "google")).toBe(103_000);
    });
  });
});

describe("shouldTriggerCompaction", () => {
  it("triggers when token count meets the non-google threshold", () => {
    expect(shouldTriggerCompaction(250_000, 400_000, "openai")).toBe(true);
    expect(shouldTriggerCompaction(249_999, 400_000, "openai")).toBe(false);
  });

  it("triggers earlier for google than for other providers", () => {
    expect(shouldTriggerCompaction(190_000, 1_000_000, "google")).toBe(true);
    expect(shouldTriggerCompaction(190_000, 1_000_000, "openai")).toBe(false);
  });

  it("respects the contextWindow - 25k floor when the cap is higher", () => {
    expect(shouldTriggerCompaction(175_000, 200_000, "openai")).toBe(true);
    expect(shouldTriggerCompaction(174_999, 200_000, "openai")).toBe(false);
    expect(shouldTriggerCompaction(175_000, 200_000, "google")).toBe(true);
  });
});

describe("supportsVision", () => {
  it("treats models without the flag as vision-capable", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
    });

    await expect(
      supportsVision({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBe(true);
  });

  it("returns false only when the flag is explicitly false", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "text-only-model",
      displayName: "Text Only Model",
      type: "cloud",
      supportsVision: false,
    });

    await expect(
      supportsVision({ provider: "provider", name: "text-only-model" }),
    ).resolves.toBe(false);
  });

  it("returns true when the flag is explicitly true", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "vision-model",
      displayName: "Vision Model",
      type: "cloud",
      supportsVision: true,
    });

    await expect(
      supportsVision({ provider: "provider", name: "vision-model" }),
    ).resolves.toBe(true);
  });

  it("treats unknown models as vision-capable", async () => {
    mockFindLanguageModel.mockResolvedValueOnce(undefined);

    await expect(
      supportsVision({ provider: "provider", name: "missing-model" }),
    ).resolves.toBe(true);
  });

  // KNOWN GAP: user-added custom models never pass through
  // convertRemoteCatalog, so the MODEL_OPTIONS overlay does not reach them —
  // even when the apiName matches a builtin we know is text-only. They read as
  // capable and fall through to the Layer 2 error message. Not worth a second
  // lookup path; revisit if users report it.
  it("does not tag custom models, even with a known text-only apiName", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      id: 7,
      apiName: "z-ai/glm-5.2",
      displayName: "GLM 5.2 (custom)",
      type: "custom",
    });

    await expect(
      supportsVision({
        provider: "openrouter",
        name: "z-ai/glm-5.2",
        customModelId: 7,
      }),
    ).resolves.toBe(true);
  });
});
