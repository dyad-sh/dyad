import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError } from "@/errors/dyad_error";
import { assertLocalModelReady } from "./validate_local_model";

vi.mock("@/lib/lm_studio_models", () => ({
  discoverLMStudioModelsCached: vi.fn(),
}));

import { discoverLMStudioModelsCached } from "@/lib/lm_studio_models";

describe("assertLocalModelReady", () => {
  beforeEach(() => {
    vi.mocked(discoverLMStudioModelsCached).mockReset();
  });

  it("passes when LM Studio has the selected model loaded", async () => {
    vi.mocked(discoverLMStudioModelsCached).mockResolvedValue({
      reachable: true,
      models: [
        {
          modelName: "qwen/qwen2.5-35b-a3b",
          displayName: "Qwen",
          provider: "lmstudio",
        },
      ],
    });

    await expect(
      assertLocalModelReady(
        { provider: "lmstudio", name: "qwen/qwen2.5-35b-a3b" },
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it("throws when LM Studio model is not loaded", async () => {
    vi.mocked(discoverLMStudioModelsCached).mockResolvedValue({
      reachable: true,
      models: [
        {
          modelName: "other-model",
          displayName: "Other",
          provider: "lmstudio",
        },
      ],
    });

    await expect(
      assertLocalModelReady(
        { provider: "lmstudio", name: "missing-model" },
        null,
      ),
    ).rejects.toBeInstanceOf(DyadError);
  });

  it("ignores cloud providers", async () => {
    await expect(
      assertLocalModelReady({ provider: "openai", name: "gpt-4o" }, null),
    ).resolves.toBeUndefined();
    expect(discoverLMStudioModelsCached).not.toHaveBeenCalled();
  });
});
