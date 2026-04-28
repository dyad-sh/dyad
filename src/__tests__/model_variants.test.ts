import { describe, expect, it } from "vitest";

import { buildModelMenuEntries } from "@/components/ModelPicker";
import { getCompactionThreshold } from "@/ipc/utils/token_utils";
import type { LanguageModel } from "@/ipc/types";

describe("buildModelMenuEntries", () => {
  it("groups model variants into a submenu entry", () => {
    const entries = buildModelMenuEntries([
      {
        apiName: "claude-sonnet-4-6",
        variantId: "default",
        displayName: "Claude Sonnet 4.6",
        variantGroup: "claude-sonnet-4-6",
        variantGroupDisplayName: "Claude Sonnet 4.6",
        variantLabel: "Default (200k)",
        contextWindow: 200_000,
      },
      {
        apiName: "claude-sonnet-4-6",
        variantId: "long-context",
        displayName: "Claude Sonnet 4.6 Long Context",
        variantGroup: "claude-sonnet-4-6",
        variantGroupDisplayName: "Claude Sonnet 4.6",
        variantLabel: "Long Context (1M)",
        contextWindow: 1_000_000,
      },
      {
        apiName: "gpt-5.4",
        displayName: "GPT 5.4",
      },
    ] satisfies LanguageModel[]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: "variant-group",
      displayName: "Claude Sonnet 4.6",
    });
    expect(entries[1]).toMatchObject({
      type: "model",
      model: { apiName: "gpt-5.4" },
    });

    if (entries[0].type !== "variant-group") {
      throw new Error("expected variant group");
    }

    expect(entries[0].models.map((model) => model.apiName)).toEqual([
      "claude-sonnet-4-6",
      "claude-sonnet-4-6",
    ]);
    expect(entries[0].models.map((model) => model.variantId)).toEqual([
      "default",
      "long-context",
    ]);
  });
});

describe("getCompactionThreshold", () => {
  it("keeps the default threshold for regular models", () => {
    expect(getCompactionThreshold(200_000)).toBe(160_000);
    expect(getCompactionThreshold(1_000_000)).toBe(180_000);
  });

  it("uses long-context variant thresholds based on usage fraction and remaining tokens", () => {
    const longContextModel = {
      apiName: "claude-sonnet-4-6",
      variantId: "long-context",
      displayName: "Claude Sonnet 4.6 Long Context",
      contextWindow: 1_000_000,
      compactionThreshold: {
        maxUsageFraction: 0.8,
        minTokensRemaining: 100_000,
      },
    } satisfies LanguageModel;

    expect(getCompactionThreshold(1_000_000, longContextModel)).toBe(800_000);
    expect(getCompactionThreshold(300_000, longContextModel)).toBe(200_000);
  });
});
