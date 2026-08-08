import { describe, expect, it } from "vitest";
import {
  getAiCoderChatAgentModel,
  getAiCoderProvider,
  getPhantomApiKey,
  getPhantomHermesApiBase,
  getPhantomHermesCompletionsUrl,
  isAiCoderEnabledForChatAgent,
  PHANTOM_HERMES_DEFAULT_API_KEY,
  shouldStreamAiCoderResponses,
} from "./ai_coder";

const baseSettings = {
  selectedModel: { provider: "openai", name: "gpt-4.1" },
  providerSettings: {},
  enableAutoUpdate: true,
  releaseChannel: "stable" as const,
  selectedTemplateId: "react",
};

describe("ai coder settings", () => {
  it("defaults provider to phantom", () => {
    expect(getAiCoderProvider(baseSettings)).toBe("phantom");
  });

  it("returns chat agent model when enabled", () => {
    const settings = {
      ...baseSettings,
      aiCoder: {
        enableForChatAgent: true,
        provider: "phantom" as const,
        model: "kimi-k2.6",
      },
    };
    expect(isAiCoderEnabledForChatAgent(settings)).toBe(true);
    expect(getAiCoderChatAgentModel(settings)).toEqual({
      provider: "phantom",
      name: "kimi-k2.6",
    });
  });

  it("streams by default", () => {
    expect(shouldStreamAiCoderResponses(baseSettings)).toBe(true);
    expect(
      shouldStreamAiCoderResponses({
        ...baseSettings,
        aiCoder: { streamResponses: false },
      }),
    ).toBe(false);
  });

  it("defaults to the hardcoded Hermes Phantom endpoint", () => {
    expect(getPhantomHermesApiBase(baseSettings)).toBe(
      "http://192.168.68.111:8642/v1",
    );
    expect(getPhantomHermesCompletionsUrl(baseSettings)).toBe(
      "http://192.168.68.111:8642/v1/chat/completions",
    );
  });

  it("falls back to the hardcoded Hermes Phantom API key", () => {
    // No saved key -> hardcoded fallback.
    expect(getPhantomApiKey(baseSettings)).toBe(PHANTOM_HERMES_DEFAULT_API_KEY);
    // Saved key wins.
    expect(
      getPhantomApiKey({
        ...baseSettings,
        providerSettings: { phantom: { apiKey: { value: "sk-user" } } },
      }),
    ).toBe("sk-user");
  });

  it("normalizes custom Phantom endpoints", () => {
    const settings = {
      ...baseSettings,
      aiCoder: {
        endpoint: "https://example.com/v1/chat/completions",
      },
    };

    expect(getPhantomHermesApiBase(settings)).toBe("https://example.com/v1");
    expect(getPhantomHermesCompletionsUrl(settings)).toBe(
      "https://example.com/v1/chat/completions",
    );
  });
});
