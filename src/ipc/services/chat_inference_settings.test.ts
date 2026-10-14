import { beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { getChatInferenceSettings } from "./chat_inference_settings";
import { shouldBillChatGPTSubscription } from "./subscription_billing";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), chat: vi.fn() }));
vi.mock("@/main/settings", () => ({ readSettings: mocks.settings }));
vi.mock("@/db", () => ({
  db: { query: { chats: { findFirst: mocks.chat } } },
}));
vi.mock("../utils/read_env", () => ({ getEnvVar: () => undefined }));

const settings = {
  enableDyadPro: true,
  providerSettings: { auto: { apiKey: { value: "accepted-key" } } },
  selectedModel: { provider: "openai", name: "gpt-5" },
} as unknown as UserSettings;
beforeEach(() => vi.resetAllMocks());

it.each(["build", "ask", "plan", "local-agent"] as const)(
  "resolves standalone auxiliary billing from stored %s rather than the default",
  async (mode) => {
    mocks.settings.mockReturnValue({
      ...settings,
      selectedChatMode: mode === "local-agent" ? "build" : "local-agent",
    });
    mocks.chat.mockResolvedValue({ chatMode: mode });
    const resolved = await getChatInferenceSettings(1);
    expect(resolved.selectedChatMode).toBe(mode);
    expect(shouldBillChatGPTSubscription(resolved)).toBe(
      mode === "local-agent",
    );
  },
);

it.each(["build", "ask", "plan", "local-agent"] as const)(
  "keeps the accepted %s billing account and mode for child requests",
  async (selectedChatMode) => {
    const accepted = { ...settings, selectedChatMode };
    mocks.settings.mockImplementation(() => {
      throw new Error("Must not re-read live billing settings");
    });
    expect(await getChatInferenceSettings(1, accepted)).toBe(accepted);
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  },
);

it("uses the stored chat model for standalone BYO helpers, not the global selection", async () => {
  mocks.settings.mockReturnValue({ ...settings, proModelUsage: "api-key" });
  mocks.chat.mockResolvedValue({
    chatMode: "local-agent",
    modelSelection: {
      provider: "anthropic",
      name: "claude-sonnet",
      effortLevel: "medium",
    },
  });
  const resolved = await getChatInferenceSettings(1);
  expect(resolved.selectedModel).toMatchObject({
    provider: "anthropic",
    name: "claude-sonnet",
  });
});
