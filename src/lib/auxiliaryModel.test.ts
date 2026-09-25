import { expect, it } from "vitest";
import type { UserSettings } from "./schemas";
import { getAuxiliarySettings } from "./auxiliaryModel";

it.each(["anthropic", "google", "ollama", "custom"])(
  "routes Pro BYO %s helpers through the engine without mutating main-chat settings",
  (provider) => {
    const settings = {
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      proModelUsage: "api-key",
      selectedModel: { provider, name: "chosen", connection: "api-key" },
    } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toEqual({
      ...settings,
      proModelUsage: "pro",
    });
    expect(settings.proModelUsage).toBe("api-key");
  },
);
it.each(["pro", "subscription", undefined] as const)(
  "preserves existing helper routing for source %s",
  (proModelUsage) => {
    const settings = { proModelUsage } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toBe(settings);
  },
);
it.each([false, true])(
  "does not enable engine billing without Pro access (toggle %s)",
  (enableDyadPro) => {
    const settings = {
      proModelUsage: "api-key",
      enableDyadPro,
      providerSettings: {},
    } as unknown as UserSettings;
    expect(getAuxiliarySettings(settings)).toBe(settings);
  },
);
it("preserves free BYO with a saved Pro key when Pro is off", () => {
  const settings = {
    proModelUsage: "api-key",
    enableDyadPro: false,
    providerSettings: { auto: { apiKey: { value: "pro-key" } } },
  } as unknown as UserSettings;
  expect(getAuxiliarySettings(settings)).toBe(settings);
});
