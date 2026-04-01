import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("summarize button appears in chat header when in a chat", async ({
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

  // Verify the persistent summarize button is visible in the chat header
  // This button should only appear when selected chat exists (not on home page)
  const summarizeButton = po.page.locator(
    '[data-testid="summarize-chat-button"]',
  );
  await expect(summarizeButton).toBeVisible({ timeout: Timeout.LONG });

  // Verify clicking the button creates a new chat
  const originalUrl = po.page.url();
  const originalChatIdMatch = originalUrl.match(/id=(\d+)/);
  const originalChatId = originalChatIdMatch
    ? parseInt(originalChatIdMatch[1])
    : null;

  await summarizeButton.click();

  // Wait for navigation to a DIFFERENT chat (not just the pattern match)
  await po.page.waitForURL(
    (url) => {
      const match = url.toString().match(/id=(\d+)/);
      return !!match && parseInt(match[1]) !== originalChatId;
    },
    { timeout: Timeout.LONG },
  );
  const newUrl = po.page.url();
  const newChatIdMatch = newUrl.match(/id=(\d+)/);
  const newChatId = newChatIdMatch ? parseInt(newChatIdMatch[1]) : null;

  // Verify we're in a different chat
  expect(newChatId).not.toBe(originalChatId);
});

test("summarize button is hidden on home page (guard clause works)", async ({
  po,
}) => {
  // Setup: Initialize app and start in home without selecting a chat
  await po.setUp();

  // Verify home route has no summarize button
  // (it should be hidden by the guard clause: {selectedChatId && (...)})
  const summarizeButton = po.page.locator(
    '[data-testid="summarize-chat-button"]',
  );

  // Give some time for the page to stabilize
  await po.page.waitForTimeout(500);

  // Verify the button is not visible when no chat is selected
  const isVisible = await summarizeButton.isVisible().catch(() => false);
  expect(isVisible).toBe(false);
});
