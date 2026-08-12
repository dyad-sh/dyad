import { PROVIDERS_THAT_SUPPORT_THINKING as GEMINI_PROVIDERS } from "../shared/language_model_constants";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { UserSettings } from "../../lib/schemas";

export function getModelEffort(settings: UserSettings): string {
  return (
    (settings.selectedModel as { effortLevel?: string } | undefined)
      ?.effortLevel ?? "medium"
  );
}

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
      getModelEffort(settings),
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

function getGeminiThinkingBudgetTokens(effortLevel: string): number {
  switch (effortLevel) {
    case "low":
      return 1_000;
    case "medium":
      return 4_000;
    case "high":
      // -1 lets Gemini dynamically decide its budget (its max).
      return -1;
    default:
      return 4_000; // Default to medium
  }
}

// This is the engine-specicific (LiteLLM) thinking configuration
function getAnthropicEngineThinkingOptions(settings: UserSettings) {
  return {
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    // Use anthropic's native effort config.
    output_config: { effort: getModelEffort(settings) },
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
    effort: getModelEffort(settings) as AnthropicProviderOptions["effort"],
    sendReasoning: true,
  };
}

export function getOpenAIProviderOptions(settings: UserSettings) {
  const effort = getModelEffort(settings);

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
