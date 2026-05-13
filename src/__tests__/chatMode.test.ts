import { describe, expect, it } from "vitest";
import { normalizeStoredChatMode, resolveChatMode } from "@/lib/chatMode";
import { getEffectiveDefaultChatMode, type UserSettings } from "@/lib/schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

describe("chat mode resolution", () => {
  it("migrates deprecated agent mode to build", () => {
    expect(normalizeStoredChatMode("agent")).toBe("build");
  });

  it("uses the effective default when a chat has no stored mode", () => {
    const settings = makeSettings({ defaultChatMode: "ask" });

    expect(
      resolveChatMode({
        storedChatMode: null,
        settings,
        envVars: {},
      }),
    ).toEqual({ mode: "ask" });
  });

  it("uses a stored mode when it is available", () => {
    const settings = makeSettings({ defaultChatMode: "build" });

    expect(
      resolveChatMode({
        storedChatMode: "plan",
        settings,
        envVars: {},
      }),
    ).toEqual({ mode: "plan" });
  });

  it("keeps stored local-agent mode when no provider is configured", () => {
    const settings = makeSettings({ defaultChatMode: "build" });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: true,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("falls back when stored local-agent mode is out of quota", () => {
    const settings = makeSettings({
      defaultChatMode: "build",
      providerSettings: {
        openai: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: false,
      }),
    ).toEqual({ mode: "build", fallbackReason: "quota-exhausted" });
  });

  it("allows stored local-agent mode with a non-OpenAI/Anthropic provider", () => {
    const settings = makeSettings({
      defaultChatMode: "build",
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: true,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("allows stored local-agent mode with a non-OpenAI/Anthropic env var provider", () => {
    const settings = makeSettings({ defaultChatMode: "build" });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: { OPENROUTER_API_KEY: "test-key" },
        freeAgentQuotaAvailable: true,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("still reports quota exhausted for stored local-agent mode with another provider", () => {
    const settings = makeSettings({
      defaultChatMode: "build",
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: false,
      }),
    ).toEqual({ mode: "build", fallbackReason: "quota-exhausted" });
  });

  it("does not auto-default to basic agent for non-OpenAI/Anthropic providers", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("build");
  });

  it("does not honor a local-agent default for non-OpenAI/Anthropic providers", () => {
    const settings = makeSettings({
      defaultChatMode: "local-agent",
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("build");
  });

  it("does not treat unknown quota as exhausted", () => {
    const settings = makeSettings({
      defaultChatMode: "build",
      providerSettings: {
        openai: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: undefined,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("allows basic agent mode when Pro is enabled without a key but free quota is available", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      defaultChatMode: "build",
      providerSettings: {
        openai: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: true,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("keeps stored local-agent mode without a provider when Pro is enabled without a key", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      defaultChatMode: "build",
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: true,
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("reports quota exhausted when Pro is enabled without a key", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      defaultChatMode: "build",
      providerSettings: {
        openai: { apiKey: { value: "test-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: false,
      }),
    ).toEqual({ mode: "build", fallbackReason: "quota-exhausted" });
  });

  it("allows stored local-agent mode for Pro users", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "dyad-key" } },
      },
    });

    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings,
        envVars: {},
        freeAgentQuotaAvailable: false,
      }),
    ).toEqual({ mode: "local-agent" });
  });
});
