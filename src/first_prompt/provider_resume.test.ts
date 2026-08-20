import { describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { resolveFirstPromptDefaultChatMode } from "./provider_resume";

const mocks = vi.hoisted(() => ({
  getHomeDefaultChatMode: vi.fn(() => "local-agent" as const),
}));

vi.mock("@/lib/homeChatMode", () => ({
  getHomeDefaultChatMode: mocks.getHomeDefaultChatMode,
}));

describe("resolveFirstPromptDefaultChatMode", () => {
  it("resolves immediately without consulting free quota", () => {
    const settings = { enableDyadPro: false } as UserSettings;
    const envVars = { OPENROUTER_API_KEY: "test-key" };

    expect(resolveFirstPromptDefaultChatMode({ settings, envVars })).toBe(
      "local-agent",
    );
    expect(mocks.getHomeDefaultChatMode).toHaveBeenCalledWith(
      settings,
      envVars,
    );
  });
});
