import { expect, it } from "vitest";
import type { UserSettings } from "./schemas";
import { getAuxiliaryModel } from "./auxiliaryModel";

const fixed = { provider: "openai", name: "small-helper" };
it.each(["anthropic", "google", "ollama", "custom"])(
  "keeps BYO %s helpers on the chosen provider without a stale source",
  (provider) => {
    const settings = {
      proModelUsage: "api-key",
      selectedModel: { provider, name: "chosen", connection: "pro" },
    } as UserSettings;
    expect(getAuxiliaryModel(settings, fixed)).toEqual({
      provider,
      name: "chosen",
    });
  },
);
it.each(["pro", "subscription", undefined] as const)(
  "preserves fixed helper models for source %s",
  (proModelUsage) => {
    expect(getAuxiliaryModel({ proModelUsage } as UserSettings, fixed)).toEqual(
      fixed,
    );
  },
);
