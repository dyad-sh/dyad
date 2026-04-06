import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("chat mode persists when switching between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1: Set to "Ask" mode
  await po.sendPrompt("[dump] chat mode test 1");
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.selectChatMode("ask");
  // Wait for mode change to propagate and DB to update
  await po.page.waitForTimeout(500);
  let modeText = await po.chatActions.getChatMode();
  expect(modeText).toContain("Ask");

  // Chat 2: Create new chat and set to "Plan" mode
  await po.chatActions.clickNewChat();
  // Wait for new chat creation
  await po.page.waitForTimeout(300);
  await po.sendPrompt("[dump] chat mode test 2");
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.selectChatMode("plan");
  // Wait for mode change to propagate and DB to update
  await po.page.waitForTimeout(500);
  modeText = await po.chatActions.getChatMode();
  expect(modeText).toContain("Plan");

  // Switch back to Chat 1 using tabs
  const allTabs = po.page.locator("div[draggable]");
  const tabCount = await allTabs.count();

  // There should be 2 tabs now
  expect(tabCount).toBeGreaterThanOrEqual(2);

  // Find the inactive tab and click it
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });

  const inactiveTabs = await inactiveTab.all();
  // Ensure we have exactly one inactive tab (Chat 1)
  expect(inactiveTabs).toHaveLength(1);

  // Click the inactive tab
  await inactiveTabs[0].locator("button").first().click();

  // Wait for the new chat to fully load before checking mode
  const messagesList = po.page.getByTestId("messages-list");
  await expect(messagesList).toBeVisible({ timeout: 5000 });

  // Wait for chat context to be fully loaded
  await po.page.waitForTimeout(300);

  // Verify Chat 1 is still in "Ask" mode
  await expect
    .poll(async () => po.chatActions.getChatMode(), { timeout: 5000 })
    .toContain("Ask");
});
