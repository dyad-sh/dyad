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
    expect(
      resolveChatMode({
        storedChatMode: null,
        settings: makeSettings({ defaultChatMode: "ask" }),
        envVars: {},
      }),
    ).toEqual({ mode: "ask" });
  });

  it("uses a stored mode", () => {
    expect(
      resolveChatMode({
        storedChatMode: "plan",
        settings: makeSettings({ defaultChatMode: "build" }),
        envVars: {},
      }),
    ).toEqual({ mode: "plan" });
  });

  it("always preserves a stored local-agent mode", () => {
    expect(
      resolveChatMode({
        storedChatMode: "local-agent",
        settings: makeSettings({
          defaultChatMode: "build",
          providerSettings: {
            openai: { apiKey: { value: "test-key" } },
          },
        }),
        envVars: {},
      }),
    ).toEqual({ mode: "local-agent" });
  });

  it("defaults free users without a provider to basic agent", () => {
    expect(getEffectiveDefaultChatMode(makeSettings(), {})).toBe("local-agent");
  });

  it("defaults free users with a non-Google provider to basic agent", () => {
    const settings = makeSettings({
      providerSettings: {
        openrouter: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {})).toBe("local-agent");
  });

  it("uses the Google-only automatic Build default", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {})).toBe("build");
  });

  it("uses basic agent when Google and another provider are configured", () => {
    const settings = makeSettings({
      providerSettings: {
        google: { apiKey: { value: "google-key" } },
        openrouter: { apiKey: { value: "openrouter-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {})).toBe("local-agent");
  });

  it("honors an explicit local-agent default for Google-only users", () => {
    const settings = makeSettings({
      defaultChatMode: "local-agent",
      providerSettings: {
        google: { apiKey: { value: "test-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {})).toBe("local-agent");
  });

  it("preserves an explicit Build default", () => {
    expect(
      getEffectiveDefaultChatMode(
        makeSettings({ defaultChatMode: "build" }),
        {},
      ),
    ).toBe("build");
  });

  it("detects eligible providers from environment variables", () => {
    expect(
      getEffectiveDefaultChatMode(makeSettings(), {
        OPENROUTER_API_KEY: "test-key",
      }),
    ).toBe("local-agent");
  });

  it("defaults Pro users to Agent", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "dyad-key" } },
      },
    });

    expect(getEffectiveDefaultChatMode(settings, {})).toBe("local-agent");
  });
});
