import { describe, expect, it } from "vitest";

import type { UserSettings } from "@/lib/schemas";
import { resolveChatModeForTurn } from "./chat_mode_resolution";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    defaultChatMode: "local-agent",
    enableAutoUpdate: true,
    providerSettings: {},
    releaseChannel: "stable",
    selectedModel: { provider: "openrouter", name: "test-model" },
    selectedTemplateId: "react",
    ...overrides,
  } as UserSettings;
}

describe("resolveChatModeForTurn", () => {
  it("uses an explicit request for the current turn", async () => {
    await expect(
      resolveChatModeForTurn({
        requestedChatMode: "plan",
        storedChatMode: "ask",
        settings: makeSettings(),
      }),
    ).resolves.toMatchObject({ mode: "plan" });
  });

  it("uses the stored mode when the request has no override", async () => {
    await expect(
      resolveChatModeForTurn({
        storedChatMode: "ask",
        settings: makeSettings(),
      }),
    ).resolves.toMatchObject({ mode: "ask" });
  });

  it.each(["agent", "build"])(
    "migrates legacy %s chats to Agent",
    async (storedChatMode) => {
      await expect(
        resolveChatModeForTurn({
          storedChatMode,
          settings: makeSettings(),
        }),
      ).resolves.toMatchObject({ mode: "local-agent" });
    },
  );
});
