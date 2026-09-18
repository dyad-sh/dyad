import { expect, it, vi } from "vitest";
vi.mock("@/main/settings", () => ({ readSettings: vi.fn() }));
vi.mock("./findLanguageModel", () => ({
  findLanguageModel: async () => undefined,
}));
import type { UserSettings } from "@/lib/schemas";
import { initialChatExecution } from "./chat_execution_selection";

it("does not pin initial created/imported chats to a disabled remembered Claude model", async () => {
  const settings = {
    selectedModel: { provider: "claude-code", name: "sonnet" },
    enableClaudeCodeSubscription: false,
    recentModels: [{ provider: "openai", name: "gpt-5" }],
  } as UserSettings;
  expect(await initialChatExecution(undefined, settings)).toMatchObject({
    executionBackend: "dyad",
    modelSelection: { provider: "openai", name: "gpt-5" },
  });
  expect(
    await initialChatExecution(undefined, { ...settings, recentModels: [] }),
  ).toMatchObject({
    executionBackend: "dyad",
    modelSelection: { provider: "auto", name: "auto" },
  });
  expect(
    await initialChatExecution(undefined, {
      ...settings,
      enableClaudeCodeSubscription: true,
    }),
  ).toMatchObject({
    executionBackend: "claude-code",
    modelSelection: { provider: "claude-code", name: "sonnet" },
  });
});
