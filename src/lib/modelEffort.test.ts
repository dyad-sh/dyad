import { describe, expect, it } from "vitest";
import { EffortSettingsSchema } from "@/ipc/types/language-model";
import {
  createModelSelection,
  formatCompactEffortLevel,
  formatEffortLevel,
  getEffortSettings,
  getModelPreferenceKey,
  resolveEffortLevel,
} from "./modelEffort";

describe("model effort", () => {
  it("uses medium and low/medium/high when catalog settings are absent", () => {
    expect(resolveEffortLevel({})).toBe("medium");
    expect(
      createModelSelection({
        model: { provider: "ollama", name: "local-model" },
        preferredEffortLevel: "high",
      }),
    ).toEqual({
      provider: "ollama",
      name: "local-model",
      effortLevel: "high",
    });
  });

  it.each(["ollama", "lmstudio", "custom::local"])(
    "offers None effort for %s and preserves it when reselecting a model",
    (provider) => {
      expect(getEffortSettings(undefined, provider)).toEqual({
        defaultEffortLevel: "medium",
        possibleEffortLevels: ["none", "low", "medium", "high"],
      });
      expect(
        createModelSelection({
          model: { provider, name: "gemma2" },
          catalogModel: { apiName: "gemma2", displayName: "Gemma 2" },
          preferredEffortLevel: "none",
        }).effortLevel,
      ).toBe("none");
    },
  );

  it("keeps cloud fallback levels and respects explicit catalog settings", () => {
    expect(getEffortSettings(undefined, "openai").possibleEffortLevels).toEqual(
      ["low", "medium", "high"],
    );
    const effortSettings = {
      defaultEffortLevel: "low",
      possibleEffortLevels: ["low", "high"],
    };
    expect(
      getEffortSettings(
        { apiName: "custom-model", displayName: "Custom", effortSettings },
        "custom::local",
      ),
    ).toEqual(effortSettings);
  });

  it("accepts arbitrary catalog levels and falls back when a preference is stale", () => {
    const catalogModel = {
      apiName: "gpt-test",
      displayName: "GPT Test",
      effortSettings: {
        defaultEffortLevel: "xhigh",
        possibleEffortLevels: ["minimal", "xhigh"],
      },
    };

    expect(
      resolveEffortLevel({ catalogModel, preferredEffortLevel: "minimal" }),
    ).toBe("minimal");
    expect(
      resolveEffortLevel({ catalogModel, preferredEffortLevel: "high" }),
    ).toBe("xhigh");
    expect(formatEffortLevel("very_high")).toBe("Very High");
  });

  it("formats common effort levels compactly without obscuring custom levels", () => {
    expect(
      ["none", "minimal", "low", "medium", "high", "xhigh", "maximum"].map(
        formatCompactEffortLevel,
      ),
    ).toEqual(["None", "Min", "Low", "Med", "High", "X-High", "Max"]);
    expect(formatCompactEffortLevel("very_high")).toBe("Very High");
  });

  it("preserves a persisted arbitrary effort while its model is unavailable", () => {
    expect(resolveEffortLevel({ preferredEffortLevel: "xhigh" })).toBe("xhigh");
    expect(
      resolveEffortLevel({
        catalogModel: {
          apiName: "model-without-effort-metadata",
          displayName: "Model",
        },
        preferredEffortLevel: "xhigh",
      }),
    ).toBe("medium");
  });

  it("uses a collision-safe preference key including custom model identity", () => {
    expect(
      getModelPreferenceKey({
        provider: "custom::one",
        name: "model:name",
        customModelId: 12,
      }),
    ).toBe('["custom::one","model:name",12]');
  });

  it("rejects invalid catalog effort schemas", () => {
    expect(
      EffortSettingsSchema.safeParse({
        defaultEffortLevel: "high",
        possibleEffortLevels: ["low", "medium"],
      }).success,
    ).toBe(false);
    expect(
      EffortSettingsSchema.safeParse({
        defaultEffortLevel: "medium",
        possibleEffortLevels: ["medium", "medium"],
      }).success,
    ).toBe(false);
  });
});
