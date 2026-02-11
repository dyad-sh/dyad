import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("tabs appear after navigating between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("[dump] build a todo app");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] build a weather app");
  await po.chatActions.waitForChatCompletion();

  // At least one tab should be visible (tabs render once there are recent chats).
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("clicking a tab switches to that chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1 - send a unique message
  await po.sendPrompt("First chat unique message alpha");
  await po.chatActions.waitForChatCompletion();

  // Chat 2 - send a different unique message
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Second chat unique message beta");
  await po.chatActions.waitForChatCompletion();

  // Wait for at least 2 tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: Timeout.MEDIUM });

  // We're on chat 2 (active). Find and click the inactive tab to switch to chat 1.
  // Each tab is a div[draggable] with a title button + close button. The active tab's title button has aria-current="page".
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab.locator("button").first().click();

  // After clicking, chat 1's message should be visible
  await expect(
    po.page.getByText("First chat unique message alpha"),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});

test("closing a tab removes it and selects adjacent tab", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("First chat message gamma");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Second chat message delta");
  await po.chatActions.waitForChatCompletion();

  // Chat 3 (currently active)
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Third chat message epsilon");
  await po.chatActions.waitForChatCompletion();

  // Wait for tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  const initialCount = await (async () => {
    let count = 0;
    await expect(async () => {
      count = await closeButtons.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: Timeout.MEDIUM });
    return count;
  })();

  // Close the active tab (chat 3). Find the tab div with aria-current="page" and click its close button.
  const activeTabDiv = po.page
    .locator("div")
    .filter({
      has: po.page.locator('button[aria-current="page"]'),
    })
    .filter({
      has: po.page.getByLabel(/^Close tab:/),
    });
  await activeTabDiv.getByLabel(/^Close tab:/).click();

  // After closing, tab count should decrease and one tab should be active
  await expect(async () => {
    const newCount = await closeButtons.count();
    expect(newCount).toBe(initialCount - 1);
  }).toPass({ timeout: Timeout.MEDIUM });

  await expect(po.page.locator('button[aria-current="page"]')).toHaveCount(1, {
    timeout: Timeout.MEDIUM,
  });
});

test("max 3 tabs are visible", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create 4 chats
  await po.sendPrompt("Chat one");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Chat two");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Chat three");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Chat four");
  await po.chatActions.waitForChatCompletion();

  // Only 3 tabs should be visible (MAX_VISIBLE_TABS = 3).
  const closeButtons = po.page.getByLabel(/^Close tab:/);

  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeLessThanOrEqual(3);
    expect(count).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });
});
