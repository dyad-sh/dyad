import { test } from "./helpers/test_helper";
import { expect, Locator, Page } from "@playwright/test";

// Helper function to navigate away from and back to a chat
async function navigateAwayAndReturn(page: Page) {
  const chatIdMatch = page.url().match(/id=(\d+)/);
  const chatId = chatIdMatch ? chatIdMatch[1] : null;

  // Navigate away from chat
  await page.goto(page.url().split("?")[0]);

  // Verify chat list is visible
  await expect(page.getByText(/chat|recent/i).first()).toBeVisible({
    timeout: 5000,
  });

  // Reopen the same chat
  if (chatId) {
    await page.goto(`${page.url()}?id=${chatId}`);
  } else {
    // Fallback: click the most recent chat in the list
    const recentChat = page.locator('[role="tab"]').first();
    await expect(recentChat).toBeVisible();
    await recentChat.click();
  }
}

test.describe("pause queue", () => {
  let chatInput: Locator;

  test.beforeEach(async ({ po }) => {
    await po.setUp();
    chatInput = po.chatActions.getChatInput();
  });

  test("pause/resume queue and cycle through multiple states", async ({
    po,
  }) => {
    const page = po.page;

    // 1. Send initial message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    // 2. Queue messages while streaming
    for (let i = 1; i <= 4; i++) {
      await chatInput.fill(`message ${i}`);
      await chatInput.press("Enter");
    }

    // 3. Verify pause button is visible
    const getPauseButton = () =>
      page.getByRole("button", { name: /pause queue/i });
    const getResumeButton = () =>
      page.getByRole("button", { name: /resume queue/i });
    await expect(getPauseButton()).toBeVisible();

    // 4. Pause the queue (blocks next message auto-send)
    await getPauseButton().click();
    await expect(page.getByText("Paused")).toBeVisible();
    await po.chatActions.waitForChatCompletion();
    await expect(page.getByText("4 Queued")).toBeVisible(); // Queue not processed

    // 5. Resume the queue (allows messages to continue)
    await getResumeButton().click();
    await expect(page.getByText("Paused")).not.toBeVisible();
    await po.chatActions.waitForChatCompletion();

    // 6. Pause again mid-way
    await getPauseButton().click();
    await expect(page.getByText("Paused")).toBeVisible();
    await po.chatActions.waitForChatCompletion();

    // 7. Final resume and let remaining messages complete
    await getResumeButton().click();
    await expect(page.getByText("Paused")).not.toBeVisible();
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // 8. Verify all messages sent and pause state cleared for new interactions
    const messagesList = page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    for (let i = 1; i <= 4; i++) {
      await expect(messagesList.getByText(`message ${i}`)).toBeVisible();
    }

    // 9. Send new message and verify pause state doesn't leak
    await po.sendPrompt("tc=2 [sleep=short]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();
    await chatInput.fill("new message");
    await chatInput.press("Enter");

    // Pause button should exist but NOT be showing paused state
    await expect(getPauseButton()).toBeVisible(); // Can pause
    await expect(page.getByText("Paused")).not.toBeVisible(); // But not already paused
  });

  test("session persistence: saved queue restored on page reopening", async ({
    po,
  }) => {
    const page = po.page;

    // 1. Send initial message
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    // 2. Queue messages while paused
    const pauseButton = page.getByRole("button", { name: /pause queue/i });
    await chatInput.fill("queued 1");
    await chatInput.press("Enter");
    await chatInput.fill("queued 2");
    await chatInput.press("Enter");
    await expect(page.getByText("2 Queued")).toBeVisible();

    // 3. Pause before stopping (persist to sessionStorage)
    await pauseButton.click();
    await expect(page.getByText("Paused")).toBeVisible();

    // 4. Stop/cancel streaming
    const stopButton = page.getByRole("button", {
      name: /cancel generation/i,
    });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    // 5. Verify queue is cleared from UI after cancel
    await expect(page.getByText("2 Queued")).not.toBeVisible();

    // 6. Navigate away and back to same chat
    await navigateAwayAndReturn(page);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // 7. Verify queue is restored with messages
    await expect(page.getByText("2 Queued")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("queued 1")).toBeVisible();
    await expect(page.getByText("queued 2")).toBeVisible();

    // 8. CRITICAL: Verify pause state was reset (NOT in paused state after reopening)
    // This tests the fix for the stale pause state bug
    await expect(page.getByText("Paused")).not.toBeVisible();
    const resumeButton = page.getByRole("button", { name: /resume queue/i });
    await expect(resumeButton).not.toBeVisible(); // Should NOT show resume button
    const pauseButtonAgain = page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButtonAgain).toBeVisible(); // Should show pause button (not paused)

    // 9. Messages should auto-process since pause state was cleared
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();
    const messagesList = page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("queued 1")).toBeVisible();
    await expect(messagesList.getByText("queued 2")).toBeVisible();
  });
});
