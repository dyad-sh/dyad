import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E tests for issue #2637: "Summarize to new chat" always accessible button
 * 
 * Tests that the persistent summarize button in the title bar is properly integrated,
 * matching the behavior pattern of the context limit banner summarize button.
 *
 * - src/app/TitleBar.tsx: ChatActionsMenu component renders the persistent button
 * - src/components/chat/SummarizeInNewChatButton.tsx: useSummarizeInNewChat hook
 * - src/components/chat/ChatInput.tsx: Manual "summarize to new chat" command handler
 */

test(
  "summarize button in title bar menu appears when in a chat",
  async ({ po }) => {
    // Setup: Create a chat with content
    await po.setUp();

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
    const summarizeOption = po.page.locator('text=Summarize to new chat');
    await expect(summarizeOption.first()).toBeVisible({ timeout: Timeout.LONG });
  },
);

test(
  "summarize button is hidden on home page (guard clause works)",
  async ({ po }) => {
    // Setup: Initialize app but don't create a chat
    await po.setUp();

    // Before any chat is created, verify the button is NOT visible
    // (it should be hidden by the guard clause: if (!selectedChatId) return null)
    const chatActionsButton = po.page.locator(
      '[data-testid="chat-more-options-button"]',
    );
    
    // Give some time for the page to stabilize
    await po.page.waitForTimeout(500);
    
    // Verify the button is not visible when no chat is selected
    const isVisible = await chatActionsButton.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  },
);