import { describe, expect, it } from "vitest";

import { getHomeDefaultChatMode } from "./homeChatMode";
import type { UserSettings } from "./schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    enableAutoUpdate: true,
    providerSettings: {},
    releaseChannel: "stable",
    selectedModel: { provider: "openrouter", name: "test-model" },
    selectedTemplateId: "react",
    ...overrides,
  } as UserSettings;
}

describe("getHomeDefaultChatMode", () => {
  it("defaults to Agent", () => {
    expect(getHomeDefaultChatMode(makeSettings())).toBe("local-agent");
  });

  it("honors an explicit default", () => {
    expect(
      getHomeDefaultChatMode(makeSettings({ defaultChatMode: "plan" })),
    ).toBe("plan");
  });
});
