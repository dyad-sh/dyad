import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("should open, navigate, and select from history menu", async ({ po }) => {
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

  // Press up arrow with empty input to open history menu
  await po.page.keyboard.press("ArrowUp");

  // Wait for history menu to appear and contain items
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(historyMenu).toBeVisible();

  // Verify menu has items (oldest at top, newest at bottom - chronological order)
  const menuItems = po.page.locator('[data-mentions-menu="true"] li');
  await expect(menuItems).toHaveCount(2);
  await expect(menuItems.nth(0)).toContainText("First test message");
  await expect(menuItems.nth(1)).toContainText("Second test message");

  // Verify default selection is the last visible item (newest message, at bottom)
  // After opening, a synthetic ArrowUp is dispatched which wraps to the bottom item
  const lastItem = menuItems.nth(1);
  await expect(lastItem).toHaveClass(/bg-accent/, { timeout: 500 });

  // Navigate up to first item (oldest message)
  await po.page.keyboard.press("ArrowUp");
  const firstItem = menuItems.nth(0);
  await expect(firstItem).toHaveClass(/bg-accent/);
  await expect(firstItem).toContainText("First test message");

  // Navigate up again to wrap to last item (newest message)
  await po.page.keyboard.press("ArrowUp");
  await expect(lastItem).toHaveClass(/bg-accent/);

  // Select with Enter (selects newest message)
  await po.page.keyboard.press("Enter");

  // Menu should close and text should be inserted
  await expect(historyMenu).not.toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(chatInput).toContainText("Second test message", {
    timeout: Timeout.MEDIUM,
  });

  // Clear input for mouse click test
  await po.openChatHistoryMenu();

  // Click the first item (oldest message, at top)
  await menuItems.nth(0).click();

  // Verify menu closed and oldest message was inserted
  await expect(historyMenu).not.toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(chatInput).toContainText("First test message", {
    timeout: Timeout.MEDIUM,
  });
});

test("should handle edge cases: guards, escape, and sending after cancel", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.getChatInput();
  const historyMenu = po.page.locator('[data-mentions-menu="true"]');

  // Test 1: Empty history guard - menu should not open with no history
  await chatInput.click();
  await chatInput.fill("");
  await po.page.keyboard.press("ArrowUp");

  const inputValue = await chatInput.textContent({ timeout: Timeout.MEDIUM });
  expect(inputValue?.trim()).toBe("");
  await expect(historyMenu).not.toBeVisible();

  // Create some history
  await po.sendPrompt("History entry for testing");
  await po.waitForChatCompletion();

  // Test 2: Non-empty input guard - menu should not open when input has content
  await chatInput.click();
  await chatInput.fill("typed content");
  await po.page.keyboard.press("ArrowUp");

  const inputValueWithContent = await chatInput.textContent({
    timeout: Timeout.MEDIUM,
  });
  expect(inputValueWithContent?.trim()).toBe("typed content");
  await expect(historyMenu).not.toBeVisible();

  // Test 3: Escape closes menu and clears input
  await po.openChatHistoryMenu();

  await po.page.keyboard.press("Escape");
  await expect(historyMenu).not.toBeVisible();

  // Test 4: After closing menu, can send regular messages
  await chatInput.click();
  await chatInput.fill("New test message after escape");
  await po.page.keyboard.press("Enter");

  await po.waitForChatCompletion();

  // Verify the message was sent
  await expect(
    po.page.getByText("New test message after escape", { exact: false }),
  ).toBeVisible();
});
