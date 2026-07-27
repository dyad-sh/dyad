import { describe, expect, it } from "vitest";

import { normalizeStoredChatMode, resolveChatMode } from "@/lib/chatMode";
import { getEffectiveDefaultChatMode, type UserSettings } from "@/lib/schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "openrouter", name: "test-model" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

describe("chat mode resolution", () => {
  it.each(["agent", "build"])(
    "migrates the legacy %s mode to Agent",
    (mode) => {
      expect(normalizeStoredChatMode(mode)).toBe("local-agent");
    },
  );

  it("rejects unknown stored modes", () => {
    expect(normalizeStoredChatMode("unknown")).toBeNull();
  });

  it("uses the configured default when a chat has no stored mode", () => {
    const settings = makeSettings({ defaultChatMode: "ask" });

    expect(resolveChatMode({ storedChatMode: null, settings })).toEqual({
      mode: "ask",
    });
  });

  it("prefers a stored active mode over the configured default", () => {
    const settings = makeSettings({ defaultChatMode: "local-agent" });

    expect(resolveChatMode({ storedChatMode: "plan", settings })).toEqual({
      mode: "plan",
    });
  });

  it("defaults to Agent", () => {
    expect(getEffectiveDefaultChatMode(makeSettings())).toBe("local-agent");
  });
});
