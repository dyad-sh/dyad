import { describe, expect, it } from "vitest";

import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { getProviderOptions } from "./provider_options";

const settingsFor = (provider: string, name: string, effortLevel: string) =>
  ({
    selectedModel: { provider, name, effortLevel },
    selectedChatMode: "build",
  }) as unknown as UserSettings;

const optionsFor = (
  settings: UserSettings,
  builtinProviderId?: string,
  reasoningEffortProviderId?: string,
) =>
  getProviderOptions({
    dyadAppId: 1,
    files: [],
    mentionedAppsCodebases: [],
    builtinProviderId,
    reasoningEffortProviderId,
    settings,
    modelSelection: settings.selectedModel as ModelSelection,
  });

describe("getProviderOptions model effort", () => {
  it("uses thinking levels for Gemini 3 direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-3-pro", "minimal"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" },
    });
  });

  it("uses thinking budgets for earlier Gemini direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "high"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    });
  });

  it("passes effort to OpenAI-compatible local and custom providers", () => {
    expect(
      optionsFor(
        settingsFor("lmstudio", "local-model", "high"),
        "lmstudio",
        "lmstudio",
      ).lmstudio,
    ).toEqual({ reasoningEffort: "high" });
    expect(
      optionsFor(
        settingsFor("custom-provider", "custom-model", "low"),
        "custom-provider",
        "custom-provider",
      )["custom-provider"],
    ).toEqual({ reasoningEffort: "low" });
  });
});
