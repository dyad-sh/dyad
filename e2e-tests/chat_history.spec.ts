import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("should open history menu when pressing up arrow with empty input", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  // Send messages to populate history
  await po.sendPrompt("First test message");
  await po.waitForChatCompletion();

  await po.sendPrompt("Second test message");
  await po.waitForChatCompletion();

  // Click on the chat input to focus it
  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Press up arrow with empty input
  await po.page.keyboard.press("ArrowUp");

  // Wait for history menu to appear and contain items
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).toBeVisible();

  // Verify menu has items
  const menuItems = po.page.locator('[data-mentions-menu="true"] li');
  await expect(menuItems).toHaveCount(2);

  // Verify we can see the prompt text in the menu
  // Most recent should be at the bottom (index 1)
  await expect(menuItems.nth(1)).toContainText("Second test message");
  await expect(menuItems.nth(0)).toContainText("First test message");
});

test("should navigate history with keyboard arrows and show selection", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  await po.sendPrompt("Prompt A");
  await po.waitForChatCompletion();

  await po.sendPrompt("Prompt B");
  await po.waitForChatCompletion();

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Open history menu
  await po.page.keyboard.press("ArrowUp");

  const menuItems = po.page.locator('[data-mentions-menu="true"] li');

  // First item should be highlighted (oldest at top)
  const firstItem = menuItems.nth(0);
  await expect(firstItem).toHaveClass(/bg-accent/);
  await expect(firstItem).toContainText("Prompt A");

  // Press down arrow
  await po.page.keyboard.press("ArrowDown");

  // Second item should now be highlighted (most recent at bottom)
  const secondItem = menuItems.nth(1);
  await expect(secondItem).toHaveClass(/bg-accent/);
  await expect(secondItem).toContainText("Prompt B");

  // Press down again - should wrap or stay at end
  await po.page.keyboard.press("ArrowDown");
  // Still at last item
  await expect(secondItem).toHaveClass(/bg-accent/);
});

test("should select and insert history item with enter key", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  const historyPrompt = "My history prompt to select";

  await po.sendPrompt(historyPrompt);
  await po.waitForChatCompletion();

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Open history menu
  await po.page.keyboard.press("ArrowUp");

  // Verify the item is in the menu
  const menuItems = po.page.locator('[data-mentions-menu="true"] li');
  await expect(menuItems.nth(0)).toContainText(historyPrompt);

  // Select with Enter
  await po.page.keyboard.press("Enter");

  // Wait for the menu to close and text to be inserted
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).not.toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify content was inserted using toContainText
  await expect(chatInput).toContainText(historyPrompt, {
    timeout: Timeout.MEDIUM,
  });
});

test("should select and insert history item with mouse click", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const historyPrompt = "Click me to select";

  await po.sendPrompt(historyPrompt);
  await po.waitForChatCompletion();

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Open history menu
  await po.page.keyboard.press("ArrowUp");

  // Wait for menu items
  const menuItems = po.page.locator('[data-mentions-menu="true"] li');
  await expect(menuItems).toHaveCount(1);

  // Click the first item
  await menuItems.nth(0).click();

  // Wait for the menu to close and text to be inserted
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).not.toBeVisible({ timeout: Timeout.MEDIUM });

  // Input should contain the selected history item
  await expect(chatInput).toContainText(historyPrompt, {
    timeout: Timeout.MEDIUM,
  });
});

test("should close history menu and clear with escape key", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.sendPrompt("Some history");
  await po.waitForChatCompletion();

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Open history menu
  await po.page.keyboard.press("ArrowUp");

  // Verify menu is open
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).toBeVisible();

  // Press escape to close
  await po.page.keyboard.press("Escape");

  // Menu should be closed
  await expect(historyMenu).not.toBeVisible();
});

test("should not open history menu if input has content", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.sendPrompt("History entry");
  await po.waitForChatCompletion();

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("typed content");

  // Press up arrow while input has content
  await po.page.keyboard.press("ArrowUp");

  // Menu should not open - input should still have content
  const inputValue = await chatInput.textContent({ timeout: Timeout.MEDIUM });
  expect(inputValue?.trim()).toBe("typed content");

  // No visible mentions menu
  const mentionsMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(mentionsMenu).not.toBeVisible();
});

test("should not open history menu if history is empty", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Press up arrow with no history
  await po.page.keyboard.press("ArrowUp");

  const inputValue = await chatInput.textContent({ timeout: Timeout.MEDIUM });
  expect(inputValue?.trim()).toBe("");

  // No visible mentions menu
  const mentionsMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(mentionsMenu).not.toBeVisible();
});

test("should close history menu and allow sending regular messages", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const historyPrompt = "Build a button component";

  // Send initial prompt to create history
  await po.sendPrompt(historyPrompt);
  await po.waitForChatCompletion();

  // Now retrieve from history
  const chatInput = po.getChatInput();
  await chatInput.click();
  await chatInput.fill("");

  // Open history menu
  await po.page.keyboard.press("ArrowUp");

  // Wait for history menu to appear
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).toBeVisible();

  // Verify the item is in the menu
  const menuItems = po.page.locator('[data-mentions-menu="true"] li');
  await expect(menuItems).toHaveCount(1);
  await expect(menuItems.nth(0)).toContainText(historyPrompt);

  // Press escape to close the menu
  await po.page.keyboard.press("Escape");

  // Menu should be closed
  await expect(historyMenu).not.toBeVisible();

  // Type a new message directly
  await chatInput.click();
  await chatInput.fill("New test message");

  // Send the message
  await po.page.keyboard.press("Enter");

  // Wait for message to be sent
  await po.waitForChatCompletion();

  // Verify the message was sent by checking it appears in the chat
  await expect(
    po.page.getByText("New test message", { exact: false }),
  ).toBeVisible();
});
