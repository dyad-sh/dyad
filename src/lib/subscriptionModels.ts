import type { LargeLanguageModel, UserSettings } from "./schemas";

/** Use the effective account catalog shared by picker status and backend routing. */
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
