import { PROVIDERS_THAT_SUPPORT_THINKING as GEMINI_PROVIDERS } from "../shared/language_model_constants";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { UserSettings } from "../../lib/schemas";

type ThinkingBudget = NonNullable<UserSettings["thinkingBudget"]>;
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

// The Dyad Engine is backed by LiteLLM using the
// OpenAI-compatible chat completions API. This means
// we need to configure thinking differently depending
// on whether user is enabling Dyad Pro (uses engine)
// or uses the regular AI-SDK provider.
export function getExtraProviderOptionsForEngine(
  providerId: string | undefined,
  settings: UserSettings,
): Record<string, any> {
  if (!providerId) {
    return {};
  }
  if (providerId === "openai") {
    // OpenAI uses the same provider options because the Dyad Engine
    // is implemented as an OpenAI-compatible provider.
    return getOpenAIProviderOptions(settings);
  }
  if (providerId === "anthropic") {
    return getAnthropicEngineThinkingOptions(settings);
  }
  if (GEMINI_PROVIDERS.includes(providerId)) {
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

function getGeminiThinkingBudgetTokens(
  thinkingBudget?: ThinkingBudget,
): number {
  switch (thinkingBudget) {
    case "low":
      return 1_000;
    case "medium":
      return 4_000;
    case "high":
    case "xhigh":
      // -1 lets Gemini dynamically decide its budget (its max). It has no
      // tier above this, so high and xhigh both map to dynamic thinking.
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
    case "xhigh":
      return "xhigh";
    case "medium":
    default:
      return "medium";
  }
}

// This is the engine-specicific (LiteLLM) thinking configuration
function getAnthropicEngineThinkingOptions(settings: UserSettings) {
  return {
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    // We use reasoning_effort because it should get mapped to output_config.effort
    // acording to https://docs.litellm.ai/docs/providers/anthropic_effort
    reasoning_effort: getThinkingBudgetEffort(settings.thinkingBudget),
  };
}

// This is the regular AI-SDK Anthropic provider options.
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
