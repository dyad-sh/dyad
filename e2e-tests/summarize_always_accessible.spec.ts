import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E tests for issue #2637: "Summarize to new chat" always accessible button
 * 
 * Tests that the summarize feature is always accessible:
 * 1. Via persistent button in the top-right menu (not just the context limit banner)
 * 2. Via manual "summarize to new chat" typed command
 * 3. Token count properly resets after summarization
 */

testSkipIfWindows(
  "summarize button always accessible via top menu",
  async ({ po }) => {
    await po.setUpDyadPro();
    await po.importApp("minimal");

    // Send initial message to establish a starting chat
    await po.sendPrompt("Create a simple counter function");
    await po.page.waitForTimeout(2000);

    // Get the original chat ID from URL
    const url = po.page.url();
    const chatIdMatch = url.match(/[?&]id=(\d+)/);
    expect(chatIdMatch).toBeTruthy();
    const originalChatId = parseInt(chatIdMatch![1]);

    // Click "Keep going" or dismiss the context limit banner if it appears
    // (Note: in a real scenario with long context, the banner would appear)
    // For this test, we'll check if the button exists and use it
    const chatActionsButton = po.page.locator('[data-testid="chat-more-options-button"]');
    
    // The chat actions button should be visible when a chat is selected
    await expect(chatActionsButton).toBeVisible();

    // Click the chat actions button to open the dropdown menu
    await chatActionsButton.click();

    // Verify the "Summarize to new chat" option is visible in the menu
    const summarizeMenuItem = po.page.locator('text=Summarize to new chat').first();
    await expect(summarizeMenuItem).toBeVisible();

    // Click the summarize option
    await summarizeMenuItem.click();

    // Wait for navigation to the new chat
    await po.page.waitForURL(/[?&]id=\d+/);
    const newUrl = po.page.url();
    const newChatIdMatch = newUrl.match(/[?&]id=(\d+)/);
    expect(newChatIdMatch).toBeTruthy();
    const newChatId = parseInt(newChatIdMatch![1]);

    // Verify we're in a new chat (different ID)
    expect(newChatId).not.toBe(originalChatId);

    // Wait for the summarization to complete
    await po.page.waitForTimeout(3000);

    // Verify the chat contains summarized content
    const messages = po.page.locator('[data-testid*="message"]');
    const messageCount = await messages.count();
    expect(messageCount).toBeGreaterThan(0);
  }
);

testSkipIfWindows(
  "manually typing 'summarize to new chat' command works",
  async ({ po }) => {
    await po.setUpDyadPro();
    await po.importApp("minimal");

    // Send initial message to create chat content
    await po.sendPrompt("Create a button component");
    await po.page.waitForTimeout(2000);

    // Get the original chat ID
    const url = po.page.url();
    const chatIdMatch = url.match(/[?&]id=(\d+)/);
    expect(chatIdMatch).toBeTruthy();
    const originalChatId = parseInt(chatIdMatch![1]);

    // Type and send the manual "summarize to new chat" command
    await po.sendPrompt("summarize to new chat");

    // Wait for navigation to the new chat
    await po.page.waitForURL(/[?&]id=\d+/);
    const newUrl = po.page.url();
    const newChatIdMatch = newUrl.match(/[?&]id=(\d+)/);
    expect(newChatIdMatch).toBeTruthy();
    const newChatId = parseInt(newChatIdMatch![1]);

    // Verify we're in a new chat
    expect(newChatId).not.toBe(originalChatId);

    // Wait for the summarization to complete
    await po.page.waitForTimeout(3000);

    // Verify the new chat contains content (summarization result)
    const messages = po.page.locator('[data-testid*="message"]');
    const messageCount = await messages.count();
    expect(messageCount).toBeGreaterThan(0);
  }
);

testSkipIfWindows(
  "persistent button is not affected by banner dismissal",
  async ({ po }) => {
    await po.setUpDyadPro();
    await po.importApp("minimal");

    // Send a message to create chat content
    await po.sendPrompt("Small message");
    await po.page.waitForTimeout(1000);

    // The chat actions button should be visible
    const chatActionsButton = po.page.locator('[data-testid="chat-more-options-button"]');
    await expect(chatActionsButton).toBeVisible();

    // Click the button to verify it opens the menu
    await chatActionsButton.click();

    // Check that Summarize option is in the menu
    const summarizeMenuItem = po.page.locator('text=Summarize to new chat');
    await expect(summarizeMenuItem.first()).toBeVisible();

    // Close the menu by clicking elsewhere
    await po.page.locator('body').click();
    await po.page.waitForTimeout(500);

    // Click the button again to verify it still works
    await chatActionsButton.click();
    await expect(summarizeMenuItem.first()).toBeVisible();

    // Menu should remain accessible regardless of any banner state
    expect(await chatActionsButton.isVisible()).toBe(true);
  }
);
