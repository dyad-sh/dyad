import { describe, expect, it } from "vitest";

import type { UserSettings } from "@/lib/schemas";
import { resolveChatModeForTurn } from "./chat_mode_resolution";

function makeFreeProSettings(
  overrides: Partial<UserSettings> = {},
): UserSettings {
  return {
    defaultChatMode: "build",
    enableAutoUpdate: true,
    providerSettings: {},
    releaseChannel: "stable",
    selectedModel: { provider: "auto", name: "free-pro" },
    selectedTemplateId: "react",
    ...overrides,
  } as UserSettings;
}

describe("resolveChatModeForTurn", () => {
  it("keeps automatic Free Pro chats out of Build mode", async () => {
    await expect(
      resolveChatModeForTurn({
        storedChatMode: null,
        settings: makeFreeProSettings(),
      }),
    ).resolves.toMatchObject({ mode: "local-agent" });
  });

  it("does not rewrite an explicit Build request", async () => {
    await expect(
      resolveChatModeForTurn({
        requestedChatMode: "build",
        storedChatMode: null,
        settings: makeFreeProSettings(),
      }),
    ).resolves.toMatchObject({ mode: "build" });
  });
});
