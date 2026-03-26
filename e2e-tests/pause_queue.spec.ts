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

      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Pause button should NOT be visible when queue is empty
    const pauseButton = po.page.getByRole("button", {
      name: /pause queue|resume queue/i,
    });
    await expect(pauseButton).not.toBeVisible();

    // Queue one message
    await chatInput.fill("queued message 1");
    await chatInput.press("Enter");

    // Pause button should NOW be visible
    await expect(pauseButton).toBeVisible();
  });

  test("should pause queue and prevent next message from sending", async ({
    po,
  }) => {
    // Send initial message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue 3 messages while streaming
    await chatInput.fill("queued message 1");
    await chatInput.press("Enter");
    await chatInput.fill("queued message 2");
    await chatInput.press("Enter");
    await chatInput.fill("queued message 3");
    await chatInput.press("Enter");

    // Verify pause button is visible
    const pauseButton = po.page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButton).toBeVisible();

    // Verify queue shows 3 messages
    await expect(po.page.getByText("3 Queued")).toBeVisible();

    // Click pause
    await pauseButton.click();

    // Verify "Paused" badge appears in queue display
    await expect(po.page.getByText("Paused")).toBeVisible();

    // Verify pause button changed to play/resume icon (aria-label changes)
    await expect(
      po.page.getByRole("button", { name: /resume queue/i }),
    ).toBeVisible();

    // Wait for current response to finish
    await po.chatActions.waitForChatCompletion();

    // Verify next message was NOT triggered (queue still shows "Paused" and original count)
    await expect(po.page.getByText("Paused")).toBeVisible();
    await expect(po.page.getByText("3 Queued")).toBeVisible();

    // Verify stop button is no longer visible (streaming finished)
    await expect(
      po.page.getByRole("button", { name: /cancel generation/i }),
    ).not.toBeVisible();
  });

  test("should resume queue after pausing", async ({ po }) => {
    // Send initial message with short sleep
    await po.sendPrompt("tc=1 [sleep=short]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue 2 messages
    await chatInput.fill("follow-up 1");
    await chatInput.press("Enter");
    await chatInput.fill("follow-up 2");
    await chatInput.press("Enter");

    // Verify pause button exists
    const pauseButton = po.page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButton).toBeVisible();

    // Click pause
    await pauseButton.click();

    // Verify paused state
    await expect(po.page.getByText("Paused")).toBeVisible();

    // Wait for current response to complete
    await po.chatActions.waitForChatCompletion();

    // Verify still paused (next message didn't auto-send)
    await expect(po.page.getByText("Paused")).toBeVisible();

    // Click resume (button now says "resume queue")
    const resumeButton = po.page.getByRole("button", {
      name: /resume queue/i,
    });
    await expect(resumeButton).toBeVisible();
    await resumeButton.click();

    // Verify paused badge is gone
    await expect(po.page.getByText("Paused")).not.toBeVisible();

    // Verify next message starts streaming (stop button reappears)
    await expect(
      po.page.getByRole("button", { name: /cancel generation/i }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for queued messages to complete
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // Verify all messages are in the chat
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=short]")).toBeVisible();
    await expect(messagesList.getByText("follow-up 1")).toBeVisible();
    await expect(messagesList.getByText("follow-up 2")).toBeVisible();
  });

  test("should persist queue to sessionStorage on Stop when queue is not empty", async ({
    po,
  }) => {
    const page = po.page;

    // Send initial message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue 2 messages
    await chatInput.fill("persisted message 1");
    await chatInput.press("Enter");
    await chatInput.fill("persisted message 2");
    await chatInput.press("Enter");

    // Verify queue shows items
    await expect(page.getByText("2 Queued")).toBeVisible();

    // Stop streaming
    const stopButton = page.getByRole("button", { name: /cancel generation/i });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    // Verify queue cleared from UI
    await expect(page.getByText("2 Queued")).not.toBeVisible();

    // Navigate away and back to test persistence
    await navigateAwayAndReturn(page);

    // Wait for chat to load
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Verify queue is restored with the 2 messages
    await expect(page.getByText("2 Queued")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("persisted message 1")).toBeVisible();
    await expect(page.getByText("persisted message 2")).toBeVisible();

    // Verify queue is NOT paused (ready to send)
    await expect(page.getByText("Paused")).not.toBeVisible();
  });

  test("should not persist queue when Stop is clicked with empty queue", async ({
    po,
  }) => {
    const page = po.page;

    // Send initial message with short sleep
    await po.sendPrompt("tc=1 [sleep=short]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Do NOT queue any messages
    // Stop streaming without queueing
    const stopButton = page.getByRole("button", { name: /cancel generation/i });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    // Navigate away and back
    await navigateAwayAndReturn(page);

    // Wait for chat to load
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Verify queue did NOT persist (no queued messages visible)
    await expect(page.getByText(/\d+ Queued/)).not.toBeVisible();
  });

  test("multiple pause/resume cycles work correctly", async ({ po }) => {
    // Send initial message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue 4 messages
    for (let i = 1; i <= 4; i++) {
      await chatInput.fill(`message ${i}`);
      await chatInput.press("Enter");
    }

    // Verify pause button exists
    const getPauseButton = () =>
      po.page.getByRole("button", { name: /pause queue/i });
    const getResumeButton = () =>
      po.page.getByRole("button", { name: /resume queue/i });

    // Cycle 1: Pause
    await expect(getPauseButton()).toBeVisible();
    await getPauseButton().click();
    await expect(po.page.getByText("Paused")).toBeVisible();
    await po.chatActions.waitForChatCompletion();

    // Cycle 2: Resume after first completion
    await expect(getResumeButton()).toBeVisible();
    await getResumeButton().click();
    await expect(po.page.getByText("Paused")).not.toBeVisible();
    await po.chatActions.waitForChatCompletion();

    // Cycle 3: Pause again before next messages start
    await expect(getPauseButton()).toBeVisible();
    await getPauseButton().click();
    await expect(po.page.getByText("Paused")).toBeVisible();
    await po.chatActions.waitForChatCompletion();

    // Cycle 4: Resume and let remaining messages send
    await expect(getResumeButton()).toBeVisible();
    await getResumeButton().click();
    await expect(po.page.getByText("Paused")).not.toBeVisible();

    // Wait for remaining queued messages to complete (2 messages left: tc=3, tc=4)
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // Verify all messages were sent
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("message 1")).toBeVisible();
    await expect(messagesList.getByText("message 2")).toBeVisible();
    await expect(messagesList.getByText("message 3")).toBeVisible();
    await expect(messagesList.getByText("message 4")).toBeVisible();
  });

  test("pause state is independent per chat tab", async ({ po }) => {
    const page = po.page;

    // In chat 1: send a message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue a message in chat 1
    await chatInput.fill("chat1 queued");
    await chatInput.press("Enter");

    // Pause chat 1
    const pauseButton = page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    await expect(page.getByText("Paused")).toBeVisible();

    // Create a new chat tab
    await po.chatActions.clickNewChat();
    await expect(chatInput).toBeVisible();

    // In chat 2: send a message with medium sleep
    await po.sendPrompt("tc=2 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Queue a message in chat 2 (should NOT be paused)
    await chatInput.fill("chat2 queued");
    await chatInput.press("Enter");

    // Pause button should exist but in normal state (not paused)
    const pauseButton2 = page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButton2).toBeVisible();

    // Verify no "Paused" badge in chat 2
    await expect(page.getByText("Paused")).not.toBeVisible();

    // Switch back to chat 1
    const chat1Tab = page.locator('[role="tab"]').filter({ hasText: /tc=1/ });
    await expect(chat1Tab.first()).toBeVisible();
    await chat1Tab.first().click();

    // Verify chat 1 is still paused
    await expect(page.getByText("Paused")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /resume queue/i }),
    ).toBeVisible();
  });

  test("visual styling shows paused state clearly", async ({ po }) => {
    // Send initial message with medium sleep
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for streaming to start
    await expect(chatInput).toBeVisible();

    // Queue messages
    await chatInput.fill("test message");
    await chatInput.press("Enter");

    // Verify pause button exists
    const pauseButton = po.page.getByRole("button", { name: /pause queue/i });
    await expect(pauseButton).toBeVisible();

    // Click pause
    await pauseButton.click();

    // Verify visual indicators
    await expect(po.page.getByText("Paused")).toBeVisible();

    // Check that the queue header has the paused styling (yellow highlight)
    const queueHeader = po.page.locator("button", { hasText: "Queued" }).first();
    const classList = await queueHeader.evaluate((el) =>
      el.parentElement?.className || "",
    );

    // Should contain yellow styling classes
    expect(classList).toContain("yellow");

    // Verify pause badge is visible
    const pausedBadge = po.page
      .locator("span", { hasText: "Paused" })
      .filter({ hasText: /paused/i });
    await expect(pausedBadge).toBeVisible();
  });
});
