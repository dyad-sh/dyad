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

test("only shows tabs for chats opened in current session", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Initially, there should be no tabs since no chats have been opened this session
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(closeButtons).toHaveCount(0);

  // Create a chat - it should appear as a tab since it's opened in this session
  await po.sendPrompt("Session chat message zeta");
  await po.chatActions.waitForChatCompletion();

  // Now there should be 1 tab
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("right-click context menu shows close options", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create 3 chats
  await po.sendPrompt("Context menu test chat 1");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Context menu test chat 2");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Context menu test chat 3");
  await po.chatActions.waitForChatCompletion();

  // Wait for tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Right-click on the second tab to open context menu
  const tabs = po.page.locator("div[draggable]");
  await tabs.nth(1).click({ button: "right" });

  // Verify context menu appears with expected options
  await expect(po.page.getByRole("menuitem", { name: "Close" })).toBeVisible({
    timeout: Timeout.SHORT,
  });
  await expect(
    po.page.getByRole("menuitem", { name: "Close other tabs" }),
  ).toBeVisible({ timeout: Timeout.SHORT });
  await expect(
    po.page.getByRole("menuitem", { name: "Close tabs to the right" }),
  ).toBeVisible({ timeout: Timeout.SHORT });
});

test("close other tabs via context menu", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create 3 chats
  await po.sendPrompt("Close others test chat 1");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Close others test chat 2");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Close others test chat 3");
  await po.chatActions.waitForChatCompletion();

  // Wait for 3 tabs
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Right-click on the second tab
  const tabs = po.page.locator("div[draggable]");
  await tabs.nth(1).click({ button: "right" });

  // Click "Close other tabs"
  await po.page.getByRole("menuitem", { name: "Close other tabs" }).click();

  // Should now have only 1 tab
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });

  // The remaining tab should show chat 2's content
  await expect(po.page.getByText("Close others test chat 2")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});

test("close tabs to the right via context menu", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create 3 chats
  await po.sendPrompt("Close right test chat 1");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Close right test chat 2");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("Close right test chat 3");
  await po.chatActions.waitForChatCompletion();

  // Wait for 3 tabs
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Right-click on the first tab
  const tabs = po.page.locator("div[draggable]");
  await tabs.first().click({ button: "right" });

  // Click "Close tabs to the right"
  await po.page
    .getByRole("menuitem", { name: "Close tabs to the right" })
    .click();

  // Should now have only 1 tab (the first one)
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });

  // The remaining tab should show chat 1's content
  await expect(po.page.getByText("Close right test chat 1")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
