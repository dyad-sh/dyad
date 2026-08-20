import { describe, expect, it } from "vitest";

import type { ModelSelection, UserSettings } from "@/lib/schemas";
import {
  getModelScopedProviderOptions,
  getProviderOptions,
} from "./provider_options";

const settingsFor = (provider: string, name: string, effortLevel: string) =>
  ({
    selectedModel: { provider, name, effortLevel },
    selectedChatMode: "build",
  }) as unknown as UserSettings;

const optionsFor = (
  settings: UserSettings,
  builtinProviderId?: string,
  reasoningEffortProviderId?: string,
  modelSelection = settings.selectedModel as ModelSelection,
) =>
  getProviderOptions({
    dyadAppId: 1,
    files: [],
    mentionedAppsCodebases: [],
    builtinProviderId,
    reasoningEffortProviderId,
    modelSelection,
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

  it("uses the resolved Gemini model when Auto routes to Google", () => {
    expect(
      optionsFor(settingsFor("auto", "auto", "medium"), "google", undefined, {
        provider: "google",
        name: "gemini-3.5-flash",
        effortLevel: "high",
      }).google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
    });
  });

  it("does not coerce catalog-defined Gemini effort levels to medium", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "xhigh"), "google")
        .google,
    ).toEqual({ thinkingConfig: { includeThoughts: true } });
  });

  it("does not send Gemini thinking config to other Google model families", () => {
    expect(
      optionsFor(settingsFor("google", "partner/model", "medium"), "google")
        .google,
    ).toBeUndefined();
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

describe("getModelScopedProviderOptions", () => {
  const selection = {
    provider: "auto",
    name: "auto",
    effortLevel: "medium",
  } as unknown as ModelSelection;

  it("matches getProviderOptions' family branch for each provider", () => {
    // The two functions must stay in lockstep: this asserts the model-scoped
    // slice equals what getProviderOptions would emit for the same family,
    // so drift in either shows up here.
    const anthropicScoped = getModelScopedProviderOptions({
      providerId: "anthropic",
      modelName: "claude-opus-4-8",
      modelSelection: selection,
    });
    const anthropicFull = optionsFor(
      settingsFor("anthropic", "claude-opus-4-8", "medium"),
      "anthropic",
      undefined,
      selection,
    );
    expect(anthropicScoped.anthropic).toEqual(anthropicFull.anthropic);

    const openaiScoped = getModelScopedProviderOptions({
      providerId: "openai",
      modelName: "gpt-5.6-sol",
      modelSelection: selection,
    });
    const openaiFull = optionsFor(
      settingsFor("openai", "gpt-5.6-sol", "medium"),
      "openai",
      undefined,
      selection,
    );
    expect(openaiScoped.openai).toEqual(openaiFull.openai);

    const googleScoped = getModelScopedProviderOptions({
      providerId: "google",
      modelName: "gemini-3-flash-preview",
      modelSelection: selection,
    });
    const googleFull = optionsFor(
      settingsFor("google", "gemini-3-flash-preview", "medium"),
      "google",
      undefined,
      { ...selection, name: "gemini-3-flash-preview" } as ModelSelection,
    );
    expect(googleScoped.google).toEqual(googleFull.google);
  });

  it("gives the anthropic family adaptive thinking (what makes temperature legal)", () => {
    const scoped = getModelScopedProviderOptions({
      providerId: "anthropic",
      modelName: "claude-opus-4-8",
      modelSelection: selection,
    });
    expect(scoped.anthropic.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
    expect(scoped.anthropic.effort).toBe("medium");
  });

  it("returns nothing for unknown families and non-thinking gemini variants", () => {
    expect(
      getModelScopedProviderOptions({
        providerId: "xai",
        modelName: "grok-4.6",
        modelSelection: selection,
      }),
    ).toEqual({});
    expect(
      getModelScopedProviderOptions({
        providerId: "google",
        modelName: "gemini-2.5-flash-lite",
        modelSelection: selection,
      }),
    ).toEqual({});
  });
});
