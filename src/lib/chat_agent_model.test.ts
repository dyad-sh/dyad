import { describe, expect, it } from "vitest";
import {
  getChatAgentModel,
  getConfiguredChatAgentModel,
  getOpenRouterFallbackForLocalChatModel,
} from "./chat_agent_model";

const baseSettings = {
  selectedModel: { provider: "openai", name: "gpt-4.1" },
  providerSettings: {},
  enableAutoUpdate: true,
  releaseChannel: "stable" as const,
  selectedTemplateId: "react",
};

describe("getChatAgentModel", () => {
  it("returns chatAgentModel when configured with an allowed provider", () => {
    const settings = {
      ...baseSettings,
      chatAgentModel: {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4",
      },
    };

    expect(getChatAgentModel(settings)).toEqual({
      provider: "openrouter",
      name: "anthropic/claude-sonnet-4",
    });
  });

  it("falls back to selectedModel when chatAgentModel is unset", () => {
    expect(getChatAgentModel(baseSettings)).toEqual({
      provider: "openai",
      name: "gpt-4.1",
    });
  });

  it("prefers AI Coder phantom when enabled for Chat Agent", () => {
    const settings = {
      ...baseSettings,
      aiCoder: {
        provider: "phantom" as const,
        model: "kimi-k2.6",
        enableForChatAgent: true,
      },
      providerSettings: {
        phantom: { apiKey: { value: "test-key" } },
      },
    };

    expect(getChatAgentModel(settings)).toEqual({
      provider: "phantom",
      name: "kimi-k2.6",
    });
  });

  it("falls back when chatAgentModel uses a disallowed provider", () => {
    const settings = {
      ...baseSettings,
      chatAgentModel: { provider: "anthropic", name: "claude-3-5-sonnet" },
    };

    expect(getChatAgentModel(settings)).toEqual(baseSettings.selectedModel);
    expect(getConfiguredChatAgentModel(settings)).toBeUndefined();
  });

  it("uses connected OpenRouter when an automatic local chat model is unavailable", () => {
    const settings = {
      ...baseSettings,
      chatAgentModel: {
        provider: "lmstudio",
        name: "qwen/qwen3.6-35b-a3b",
      },
      aiCoder: {
        provider: "openrouter" as const,
        model: "qwen/qwen3.6-35b-a3b",
      },
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-key" } },
      },
    };

    expect(
      getOpenRouterFallbackForLocalChatModel(settings, settings.chatAgentModel),
    ).toEqual({
      provider: "openrouter",
      name: "qwen/qwen3.6-35b-a3b",
    });
  });

  it("does not cloud-fallback a manually assigned local chat role", () => {
    const selectedModel = {
      provider: "lmstudio",
      name: "local-model",
    };
    const settings = {
      ...baseSettings,
      modelRoles: {
        chat: { auto: false, model: selectedModel },
      },
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-key" } },
      },
    };

    expect(
      getOpenRouterFallbackForLocalChatModel(settings, selectedModel),
    ).toBeUndefined();
  });
});
