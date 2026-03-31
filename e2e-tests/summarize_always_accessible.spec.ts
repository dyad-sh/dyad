import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("summarize button in title bar menu appears when in a chat", async ({
  po,
}) => {
  // Setup: Initialize and import a minimal app to open a real chat context
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create or switch to an active chat
  await po.chatActions.clickNewChat();
  await po.page.waitForURL(/\/chat\?id=\d+/, { timeout: Timeout.LONG });

  // Send a message to create chat content
  await po.sendPrompt("Create a simple React component");

  // Verify the persistent button is visible in the title bar
  // This button should only appear when selected chat exists (not on home page)
  const chatActionsButton = po.page.locator(
    '[data-testid="chat-more-options-button"]',
  );
  await expect(chatActionsButton).toBeVisible({ timeout: Timeout.LONG });

  // Verify the button opens a menu with the summarize option
  await chatActionsButton.click();
  const summarizeOption = po.page.locator("text=Summarize to new chat");
  await expect(summarizeOption.first()).toBeVisible({ timeout: Timeout.LONG });
});

test("summarize button is hidden on home page (guard clause works)", async ({
  po,
}) => {
  // Setup: Initialize app and start in home without selecting a chat
  await po.setUp();

  // Verify home route has no selected chat button
  // (it should be hidden by the guard clause: if (!selectedChatId) return null)
  const chatActionsButton = po.page.locator(
    '[data-testid="chat-more-options-button"]',
  );

  // Give some time for the page to stabilize
  await po.page.waitForTimeout(500);

  // Verify the button is not visible when no chat is selected
  const isVisible = await chatActionsButton.isVisible().catch(() => false);
  expect(isVisible).toBe(false);
});
