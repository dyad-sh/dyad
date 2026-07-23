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

  it("allows stored local-agent mode with Google/Gemini", () => {
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

  it("allows stored local-agent mode with a non-Google env var provider", () => {
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

  it("does not auto-default to basic agent for Google/Gemini", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("build");
  });

  it("keeps the Google-only fallback while quota is unresolved", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, undefined)).toBe("build");
  });

  it("optimistically defaults to basic agent without a provider", () => {
    expect(getEffectiveDefaultChatMode(makeSettings(), {}, undefined)).toBe(
      "local-agent",
    );
  });

  it("falls back to build only after quota exhaustion is confirmed", () => {
    expect(getEffectiveDefaultChatMode(makeSettings(), {}, false)).toBe(
      "build",
    );
  });

  it("uses basic agent when Google and an eligible provider are configured", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "google-key" } },
        openrouter: { apiKey: { value: "openrouter-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("local-agent");
  });

  it("preserves an explicit build default", () => {
    expect(
      getEffectiveDefaultChatMode(
        makeSettings({ defaultChatMode: "build" }),
        {},
        undefined,
      ),
    ).toBe("build");
  });

  it("auto-defaults to basic agent for a non-Google provider", () => {
    const settings = makeSettings({
      providerSettings: {
        openrouter: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("local-agent");
  });

  it("auto-defaults to basic agent for Vertex", () => {
    const settings = makeSettings({
      providerSettings: {
        vertex: {
          serviceAccountKey: { value: "test-key" },
          projectId: "test-project",
          location: "us-central1",
        },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("local-agent");
  });

  it("auto-defaults to basic agent for a non-Google env var provider", () => {
    const settings = makeSettings();

    expect(
      getEffectiveDefaultChatMode(
        settings,
        { OPENROUTER_API_KEY: "test-key" },
        true,
      ),
    ).toBe("local-agent");
  });

  it("honors a local-agent default for a non-Google provider", () => {
    const settings = makeSettings({
      defaultChatMode: "local-agent",
      providerSettings: {
        openrouter: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("local-agent");
  });

  it("honors an explicit local-agent default for Google/Gemini", () => {
    const settings = makeSettings({
      defaultChatMode: "local-agent",
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {}, true)).toBe("local-agent");
    expect(getEffectiveDefaultChatMode(settings, {}, undefined)).toBe(
      "local-agent",
    );
    expect(getEffectiveDefaultChatMode(settings, {}, false)).toBe("build");
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
