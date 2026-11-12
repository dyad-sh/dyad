import { describe, expect, it } from "vitest";
import { EffortSettingsSchema } from "@/ipc/types/language-model";
import {
  createModelSelection,
  formatCompactEffortLevel,
  formatEffortLevel,
  formatEffortLevelsInput,
  getEffortSettings,
  getModelPreferenceKey,
  parseEffortLevelsInput,
  resolveEffortLevel,
} from "./modelEffort";

describe("custom model effort levels input", () => {
  it("parses comma-separated levels with the first as the default", () => {
    const settings = parseEffortLevelsInput(" xhigh, medium ,low,, medium ");
    expect(settings).toEqual({
      defaultEffortLevel: "xhigh",
      possibleEffortLevels: ["xhigh", "medium", "low"],
    });
    expect(EffortSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("de-duplicates levels case-insensitively, keeping the first spelling", () => {
    expect(parseEffortLevelsInput("High, high, Medium")).toEqual({
      defaultEffortLevel: "High",
      possibleEffortLevels: ["High", "Medium"],
    });
  });

  it("keeps the previous settings unchanged when the text was not edited", () => {
    const previous = {
      defaultEffortLevel: "medium",
      possibleEffortLevels: ["low", "medium", "high"],
    };
    // Displayed as "medium, low, high"; saving untouched must not reorder or
    // move the default.
    expect(
      parseEffortLevelsInput(formatEffortLevelsInput(previous), previous),
    ).toBe(previous);
    // Once edited, the text is authoritative again.
    expect(parseEffortLevelsInput("low, medium", previous)).toEqual({
      defaultEffortLevel: "low",
      possibleEffortLevels: ["low", "medium"],
    });
  });

  it("treats empty input as unset so Dyad's defaults apply", () => {
    expect(parseEffortLevelsInput("")).toBeUndefined();
    expect(parseEffortLevelsInput(" , ,")).toBeUndefined();
  });

  it("formats with the default level first and round-trips", () => {
    const settings = {
      defaultEffortLevel: "medium",
      possibleEffortLevels: ["low", "medium", "xhigh"],
    };
    expect(formatEffortLevelsInput(settings)).toBe("medium, low, xhigh");
    expect(formatEffortLevelsInput(undefined)).toBe("");
    expect(parseEffortLevelsInput(formatEffortLevelsInput(settings))).toEqual({
      defaultEffortLevel: "medium",
      possibleEffortLevels: ["medium", "low", "xhigh"],
    });
  });

  it("drives the picker's levels and default for a custom model", () => {
    const model = {
      apiName: "my-model",
      displayName: "My Model",
      type: "custom" as const,
      effortSettings: parseEffortLevelsInput("xhigh, medium, low"),
    };
    expect(getEffortSettings(model).possibleEffortLevels).toEqual([
      "xhigh",
      "medium",
      "low",
    ]);
    expect(resolveEffortLevel({ catalogModel: model })).toBe("xhigh");
    // A stale "high" preference (not offered by this model) falls back to the default.
    expect(
      resolveEffortLevel({ catalogModel: model, preferredEffortLevel: "high" }),
    ).toBe("xhigh");
  });
});

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
