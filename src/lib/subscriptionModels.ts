import type { LargeLanguageModel, UserSettings } from "./schemas";

export const CHATGPT_PLAN_LABELS = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
} as const;
export type ChatGPTPlanType = keyof typeof CHATGPT_PLAN_LABELS;

export function normalizeChatGPTPlanType(
  value: unknown,
): ChatGPTPlanType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (
    normalized === "self_serve_business_prolite" ||
    normalized === "self_serve_business_usage_based"
  ) {
    return "business";
  }
  return Object.hasOwn(CHATGPT_PLAN_LABELS, normalized)
    ? (normalized as ChatGPTPlanType)
    : undefined;
}

export function getSubscriptionDefaultModel(
  models: string[],
  planType: string | undefined,
  current: LargeLanguageModel,
): string | undefined {
  if (planType !== "plus" && planType !== "pro") {
    return models.includes("gpt-5.6-luna") ? "gpt-5.6-luna" : models[0];
  }
  return current.provider === "openai" && models.includes(current.name)
    ? current.name
    : models[0];
}

export function isChatGPTAutoSelection(
  model: Pick<LargeLanguageModel, "provider" | "name">,
): boolean {
  return (
    model.provider === "auto" &&
    (model.name === "auto" || model.name === "auto-sidekick")
  );
}

/** Use the effective account catalog shared by picker status and backend routing. */
export function usesChatGPTSubscription(
  model: Pick<LargeLanguageModel, "provider" | "name">,
  settings: Pick<UserSettings, "proModelUsage">,
  subscription: { connected: boolean; models: string[] },
): boolean {
  return Boolean(
    settings.proModelUsage !== "pro" &&
    settings.proModelUsage !== "api-key" &&
    subscription.connected &&
    model.provider === "openai" &&
    subscription.models.includes(model.name),
  );
}
