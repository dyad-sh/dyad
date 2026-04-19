import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("chat mode persists when switching between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("[dump] chat mode test 1");
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.selectChatMode("ask");

  await expect
    .poll(async () => po.chatActions.getChatMode(), { timeout: 5000 })
    .toContain("Ask");

  await po.chatActions.clickNewChat();

  await expect(po.page.getByTestId("chat-mode-selector")).toBeVisible({
    timeout: 5000,
  });
  await po.sendPrompt("[dump] chat mode test 2");
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.selectChatMode("plan");

  await expect
    .poll(async () => po.chatActions.getChatMode(), { timeout: 5000 })
    .toContain("Plan");

  const allTabs = po.page.locator("div[draggable]");
  const tabCount = await allTabs.count();

  expect(tabCount).toBeGreaterThanOrEqual(2);

  const inactiveTabs = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  const inactiveCount = await inactiveTabs.count();
  let foundAskTab = false;

  for (let i = 0; i < inactiveCount; i++) {
    await inactiveTabs.nth(i).locator("button").first().click();

    try {
      await expect
        .poll(async () => po.chatActions.getChatMode(), { timeout: 2000 })
        .toContain("Ask");
      foundAskTab = true;
      break;
    } catch {}
  }

  expect(foundAskTab).toBe(true);

  const messagesList = po.page.getByTestId("messages-list");
  await expect(messagesList).toBeVisible({ timeout: 5000 });

  await expect
    .poll(async () => po.chatActions.getChatMode(), { timeout: 5000 })
    .toContain("Ask");
});
