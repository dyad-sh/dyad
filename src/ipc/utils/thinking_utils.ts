import { PROVIDERS_THAT_SUPPORT_THINKING as GOOGLE_THINKING_PROVIDERS } from "../shared/language_model_constants";
import type { UserSettings } from "../../lib/schemas";

function getThinkingBudgetTokens(
  thinkingBudget: "low" | "medium" | "high" | undefined,
  { supportsDynamicBudget }: { supportsDynamicBudget: boolean },
): number {
  switch (thinkingBudget) {
    case "low":
      return 4_000;
    case "medium":
      return 16_000;
    case "high":
      return supportsDynamicBudget ? -1 : 32_000;
    default:
      return 16_000; // Default to medium
  }
}

export function getExtraProviderOptions(
  providerId: string | undefined,
  settings: UserSettings,
): Record<string, any> {
  if (!providerId) {
    return {};
  }
  if (providerId === "openai") {
    if (settings.selectedChatMode === "local-agent") {
      return {
        reasoning: {
          summary: "detailed",
          effort: "medium",
        },
      };
    }
    return { reasoning_effort: "medium" };
  }
  if (providerId === "anthropic") {
    const budgetTokens = getThinkingBudgetTokens(settings?.thinkingBudget, {
      supportsDynamicBudget: false,
    });
    return { thinking: { type: "enabled", budget_tokens: budgetTokens } };
  }
  if (GOOGLE_THINKING_PROVIDERS.includes(providerId)) {
    const budgetTokens = getThinkingBudgetTokens(settings?.thinkingBudget, {
      supportsDynamicBudget: true,
    });
    return {
      thinking: {
        type: "enabled",
        include_thoughts: true,
        // -1 means dynamic thinking where model determines.
        // budget_tokens: 128, // minimum for Gemini Pro is 128
        budget_tokens: budgetTokens,
      },
    };
  }
  return {};
}
