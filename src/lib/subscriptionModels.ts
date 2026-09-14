import type { LargeLanguageModel, UserSettings } from "./schemas";

/** The account's Codex model catalog is authoritative, not a name-prefix guess. */
export function usesChatGPTSubscription(
  model: Pick<LargeLanguageModel, "provider" | "name">,
  settings: Pick<
    UserSettings,
    "enableDyadPro" | "proModelUsage" | "providerSettings"
  >,
  subscription: { connected: boolean; models: string[] },
): boolean {
  return Boolean(
    settings.enableDyadPro &&
    settings.providerSettings?.auto?.apiKey?.value &&
    settings.proModelUsage !== "pro" &&
    subscription.connected &&
    model.provider === "openai" &&
    subscription.models.includes(model.name),
  );
}
