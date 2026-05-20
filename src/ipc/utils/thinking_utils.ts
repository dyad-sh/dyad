import { PROVIDERS_THAT_SUPPORT_THINKING } from "../shared/language_model_constants";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { UserSettings } from "../../lib/schemas";

type ThinkingBudget = NonNullable<UserSettings["thinkingBudget"]>;
type ReasoningEffort = "low" | "medium" | "high";

function getGeminiThinkingBudgetTokens(
  thinkingBudget?: ThinkingBudget,
): number {
  switch (thinkingBudget) {
    case "low":
      return 1_000;
    case "medium":
      return 4_000;
    case "high":
      return -1;
    default:
      return 4_000; // Default to medium
  }
}

export function getThinkingBudgetEffort(
  thinkingBudget?: ThinkingBudget,
): ReasoningEffort {
  switch (thinkingBudget) {
    case "low":
      return "low";
    case "high":
      return "high";
    case "medium":
    default:
      return "medium";
  }
}

function getAnthropicEngineThinkingOptions(settings: UserSettings) {
  return {
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    reasoning_effort: getThinkingBudgetEffort(settings.thinkingBudget),
  };
}

export function getAnthropicProviderOptions(
  settings: UserSettings,
): AnthropicProviderOptions {
  return {
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    effort: getThinkingBudgetEffort(settings.thinkingBudget),
    sendReasoning: true,
  };
}

export function getOpenAIProviderOptions(settings: UserSettings) {
  const effort = getThinkingBudgetEffort(settings.thinkingBudget);

  if (settings.selectedChatMode === "local-agent") {
    return {
      reasoning: {
        summary: "detailed",
        effort,
      },
      include: ["reasoning.encrypted_content"],
      store: false,
    };
  }

  return { reasoning_effort: effort };
}

export function getExtraProviderOptions(
  providerId: string | undefined,
  settings: UserSettings,
): Record<string, any> {
  if (!providerId) {
    return {};
  }
  if (providerId === "openai") {
    return getOpenAIProviderOptions(settings);
  }
  if (providerId === "anthropic") {
    return getAnthropicEngineThinkingOptions(settings);
  }
  if (PROVIDERS_THAT_SUPPORT_THINKING.includes(providerId)) {
    const budgetTokens = getGeminiThinkingBudgetTokens(
      settings?.thinkingBudget,
    );
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
