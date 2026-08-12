import { describe, expect, it } from "vitest";
import { EffortSettingsSchema } from "@/ipc/types/language-model";
import {
  createModelSelection,
  formatEffortLevel,
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
