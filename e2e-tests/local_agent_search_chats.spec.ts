import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("local-agent - searches historical chats", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  // For Pro, explore_chat_history supersedes direct search_chats in the
  // toolset. Opting the explorer out via consent re-exposes search_chats —
  // this spec covers exactly that fallback path (and the legacy card).
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      agentToolConsents: { explore_chat_history: "never" },
    });
  });
  await po.importApp("minimal");

  // The import creates AI_RULES.md in an initial assistant turn. Let that
  // finish, then start a clean historical chat so its Retry button cannot
  // make sendPrompt return before this scenario's turn settles.
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.clickNewChat();
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt(
    "tc=local-agent/simple-response quartzneedle decision: use Postgres for persistence",
  );

  // Chat indexing is debounced for 500 ms after a turn settles.
  await po.page.waitForTimeout(750);
  await po.chatActions.clickNewChat();
  await po.sendPrompt("tc=local-agent/search-chats");

  const searchCard = po.page.getByTestId("dyad-search-chats");
  await expect(searchCard).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(searchCard).toContainText("quartzneedle");
  await expect(searchCard).toContainText("1 chat");

  await searchCard.click();
  await expect(searchCard).toContainText("use Postgres for persistence");
});
