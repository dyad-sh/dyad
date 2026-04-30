import { describe, expect, it, vi } from "vitest";

import { getTemperature } from "../ipc/utils/token_utils";
import { findLanguageModel } from "../ipc/utils/findLanguageModel";

vi.mock("../../src/main/settings", () => ({
  readSettings: vi.fn(),
}));

vi.mock("../ipc/utils/findLanguageModel", () => ({
  findLanguageModel: vi.fn(),
}));

const mockFindLanguageModel = vi.mocked(findLanguageModel);

describe("getTemperature", () => {
  it("does not set a default temperature for custom models", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      id: 1,
      apiName: "custom-model",
      displayName: "Custom Model",
      type: "custom",
    });

    await expect(
      getTemperature({ provider: "custom::provider", name: "custom-model" }),
    ).resolves.toBeUndefined();
  });

  it("keeps the fallback temperature for non-custom models without metadata", async () => {
    mockFindLanguageModel.mockResolvedValueOnce({
      apiName: "cloud-model",
      displayName: "Cloud Model",
      type: "cloud",
    });

    await expect(
      getTemperature({ provider: "provider", name: "cloud-model" }),
    ).resolves.toBe(0);
  });
});
