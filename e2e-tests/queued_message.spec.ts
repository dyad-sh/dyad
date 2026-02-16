import { test } from "./helpers/test_helper";
import { expect, Locator } from "@playwright/test";

test.describe("queued messages", () => {
  let chatInput: Locator;

  test.beforeEach(async ({ po }) => {
    await po.setUp();
    chatInput = po.chatActions.getChatInput();
  });

  test("gets added and sent after stream completes", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // While streaming, send another message - this should be queued
    await chatInput.fill("tc=2");
    await chatInput.press("Enter");

    // Verify the queued message indicator is visible
    // The UI shows "{count} Queued" followed by "- {status}"
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).toBeVisible();

    // Wait for the first stream to complete
    await po.chatActions.waitForChatCompletion();

    // Verify the queued message indicator is gone (message is now being sent)
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).not.toBeVisible();

    // Wait for the queued message to also complete
    await po.chatActions.waitForChatCompletion();

    // Verify both messages were sent by checking the message list
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("tc=2")).toBeVisible();
  });

  test("can be reordered, deleted, and edited", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // Queue 3 messages while streaming
    await chatInput.fill("tc=first");
    await chatInput.press("Enter");
    await chatInput.fill("tc=second");
    await chatInput.press("Enter");
    await chatInput.fill("tc=third");
    await chatInput.press("Enter");

    // Verify 3 messages are queued
    await expect(po.page.getByText("3 Queued")).toBeVisible();

    // Reorder: move "tc=third" up so it swaps with "tc=second"
    const thirdRow = po.page.locator("li", { hasText: "tc=third" });
    await thirdRow.hover();
    await thirdRow.getByTitle("Move up").click();

    // Delete: remove "tc=second" (now the last item after the reorder)
    const secondRow = po.page.locator("li", { hasText: "tc=second" });
    await secondRow.hover();
    await secondRow.getByTitle("Delete").click();

    // Verify count dropped to 2
    await expect(po.page.getByText("2 Queued")).toBeVisible();

    // Edit: click edit on "tc=first", modify the text, and submit
    const firstRow = po.page.locator("li", { hasText: "tc=first" });
    await firstRow.hover();
    await firstRow.getByTitle("Edit").click();

    // The input should now contain the message text
    await expect(chatInput).toContainText("tc=first");

    // Clear and type the new text
    await chatInput.click();
    await po.page.keyboard.press("ControlOrMeta+a");
    await chatInput.pressSequentially("tc=first-edited");
    await chatInput.press("Enter");

    // Verify the edited text appears in the queue
    await expect(
      po.page.locator("li", { hasText: "tc=first-edited" }),
    ).toBeVisible();

    // Wait for the initial stream to finish, then the queued messages to send
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // Verify the final messages were sent in correct order:
    // "tc=first-edited" first, then "tc=third" (which was moved up past "tc=second")
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=first-edited")).toBeVisible();
    await expect(messagesList.getByText("tc=third")).toBeVisible();
    // "tc=second" was deleted, so it should NOT appear
    await expect(messagesList.getByText("tc=second")).not.toBeVisible();
  });
});
