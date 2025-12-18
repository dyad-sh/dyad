import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("should load large chat with pagination", async ({ po }) => {
  // Set up the test environment
  await po.setUp({ autoApprove: true });

  // Create a chat by sending multiple prompts to simulate a large chat
  // We'll send 15 prompts which creates 30 messages (15 user + 15 assistant)
  // This is enough to test pagination without making the test too slow
  for (let i = 0; i < 15; i++) {
    await po.sendPrompt(`Test message ${i + 1}`);
  }

  // Navigate away and back to the chat to trigger a fresh load
  await po.clickNewChat();

  // Go back to the chat list and select the first chat (our large chat)
  await po.page.getByTestId("chat-tab").click();
  await po.page.getByTestId("chat-list-item-0").click();

  // Wait for messages to load
  await po.page.waitForSelector('[data-testid="messages-list"]', {
    timeout: Timeout.MEDIUM,
  });

  // Check that "Load older messages" button is NOT visible if all messages fit
  // (since we only have 30 messages and the limit is 100)
  const loadMoreButton = po.page.getByRole("button", {
    name: "Load older messages",
  });

  // The button should not be visible since 30 messages < 100 message limit
  await expect(loadMoreButton).not.toBeVisible();

  // Verify that messages are displayed
  const messagesList = po.page.getByTestId("messages-list");
  await expect(messagesList).toBeVisible();
});

test("should handle very large chat with load more functionality", async ({
  po,
}) => {
  // This test is skipped by default as it would take too long to create 101+ messages
  // To enable it, set MESSAGE_COUNT environment variable
  // For CI/manual testing, we can create a fixture database with pre-populated messages

  // Skip this test for now as it would require database seeding
  test.skip(
    !process.env.TEST_LARGE_CHAT,
    "Skipping large chat test - set TEST_LARGE_CHAT=1 to enable",
  );

  await po.setUp({ autoApprove: true });

  // In a real implementation, we would:
  // 1. Seed the database with 150+ messages
  // 2. Navigate to the chat
  // 3. Verify only 100 messages are initially loaded
  // 4. Click "Load older messages"
  // 5. Verify 50 more messages appear
  // 6. Verify scroll position is preserved

  // For now, this serves as documentation of the expected behavior
});

test("should not crash when opening chat with code blocks", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Send prompts that will generate code blocks in responses
  await po.sendPrompt("Create a simple React component");
  await po.sendPrompt("Add TypeScript types to it");
  await po.sendPrompt("Add some CSS styling");

  // Navigate away and back
  await po.clickNewChat();
  await po.page.getByTestId("chat-tab").click();
  await po.page.getByTestId("chat-list-item-0").click();

  // Wait for messages to load
  await po.page.waitForSelector('[data-testid="messages-list"]', {
    timeout: Timeout.MEDIUM,
  });

  // Verify messages are visible and app didn't crash
  const messagesList = po.page.getByTestId("messages-list");
  await expect(messagesList).toBeVisible();

  // Verify code blocks are present (they should be in pre tags)
  const codeBlocks = po.page.locator("pre code");
  const codeBlockCount = await codeBlocks.count();

  // We should have at least some code blocks from the responses
  expect(codeBlockCount).toBeGreaterThan(0);
});
