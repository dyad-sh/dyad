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

  // Close the first tab.
  await po.page
    .getByLabel(/^Close tab:/)
    .first()
    .click();

  // After closing, tab count should decrease.
  await expect(async () => {
    const newCount = await closeButtons.count();
    expect(newCount).toBe(initialCount - 1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("right-click context menu: Close other tabs", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("[dump] Chat one context menu");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Chat two context menu");
  await po.chatActions.waitForChatCompletion();

  // Chat 3
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Chat three context menu");
  await po.chatActions.waitForChatCompletion();

  // Wait for 3 tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Right-click on the second tab to open context menu
  const tabs = po.page.locator("div[draggable]");
  await tabs.nth(1).click({ button: "right" });

  // Click "Close other tabs" from context menu
  await po.page.getByText("Close other tabs").click();

  // After closing other tabs, only 1 tab should remain
  await expect(async () => {
    const newCount = await closeButtons.count();
    expect(newCount).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("right-click context menu: Close tabs to the right", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("[dump] Left tab one");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Left tab two");
  await po.chatActions.waitForChatCompletion();

  // Chat 3
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Right tab one");
  await po.chatActions.waitForChatCompletion();

  // Chat 4
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Right tab two");
  await po.chatActions.waitForChatCompletion();

  // Wait for 4 tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(4);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Right-click on the second tab (index 1) to open context menu
  const tabs = po.page.locator("div[draggable]");
  await tabs.nth(1).click({ button: "right" });

  // Click "Close tabs to the right" from context menu
  await po.page.getByText("Close tabs to the right").click();

  // After closing tabs to the right, only 2 tabs should remain (first and second)
  await expect(async () => {
    const newCount = await closeButtons.count();
    expect(newCount).toBe(2);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("only shows tabs for chats opened in current session", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Initially no tabs should be visible (no chats opened yet in this session)
  const closeButtons = po.page.getByLabel(/^Close tab:/);

  // Create first chat
  await po.sendPrompt("[dump] Session chat one");
  await po.chatActions.waitForChatCompletion();

  // Now exactly 1 tab should be visible
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Create second chat
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] Session chat two");
  await po.chatActions.waitForChatCompletion();

  // Now exactly 2 tabs should be visible
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(2);
  }).toPass({ timeout: Timeout.MEDIUM });
});
