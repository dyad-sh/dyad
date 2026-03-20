import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
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

  test("fires queued message while on another page", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // While streaming, queue a second message
    await chatInput.fill("tc=2");
    await chatInput.press("Enter");

    // Verify the queued message indicator is visible
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).toBeVisible();

    // Navigate away from the chat page while streaming + queue are active
    await po.sleep(1_000);
    await po.navigation.goToAppsTab();

    // Wait for the in-progress indicator to disappear, meaning both the
    // first stream and the queued message have completed in the background
    await expect(
      po.page.locator('[aria-label="Chat in progress"]'),
    ).not.toBeVisible({ timeout: 30_000 });

    // Navigate back to the chat to verify both messages were sent
    const chatTab = po.page
      .locator("button")
      .filter({ hasText: /Chat/ })
      .first();
    await chatTab.click();

    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("tc=2")).toBeVisible();
  });
});

testSkipIfWindows(
  "editing queued message restores attachments and selected components",
  async ({ po }) => {
    await po.setUp();
    const chatInput = po.chatActions.getChatInput();

    // Build an app so we have a preview with selectable components
    await po.sendPrompt("tc=basic");
    await po.previewPanel.clickTogglePreviewPanel();

    // Start a slow streaming response so subsequent messages get queued
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    // While streaming, select a component
    await po.previewPanel.clickPreviewPickElement();
    await po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "Welcome to Your Blank App" })
      .click();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    // Attach a file
    await po.chatActions
      .getChatInputContainer()
      .getByTestId("auxiliary-actions-menu")
      .click();
    await po.page.getByRole("menuitem", { name: "Attach files" }).click();
    const chatContextItem = po.page.getByText("Attach file as chat context");
    await expect(chatContextItem).toBeVisible();
    const fileChooserPromise = po.page.waitForEvent("filechooser");
    await chatContextItem.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("e2e-tests/fixtures/images/logo.png");
    await expect(po.page.getByText("logo.png")).toBeVisible();

    // Queue a message with both attachment and selected component
    await chatInput.fill("queued with extras");
    await chatInput.press("Enter");

    // After queuing, both should be cleared
    await expect(
      po.previewPanel.getSelectedComponentsDisplay(),
    ).not.toBeVisible();
    await expect(po.page.getByText("logo.png")).not.toBeVisible();
    await expect(po.page.getByText(/\d+ Queued/)).toBeVisible();

    // Edit the queued message
    const queuedRow = po.page.locator("li", {
      hasText: "queued with extras",
    });
    await queuedRow.hover();
    await queuedRow.getByTitle("Edit").click();

    // The input should contain the queued message text
    await expect(chatInput).toContainText("queued with extras");

    // Both attachment and selected components should be restored
    await expect(po.page.getByText("logo.png")).toBeVisible();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    // Submit the edit — both should clear again
    await chatInput.press("Enter");
    await expect(po.page.getByText("logo.png")).not.toBeVisible();
    await expect(
      po.previewPanel.getSelectedComponentsDisplay(),
    ).not.toBeVisible();

    // Wait for all messages to complete
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // Verify both messages were sent
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("queued with extras")).toBeVisible();
  },
);

testSkipIfWindows(
  "canceling queued message edit clears restored components",
  async ({ po }) => {
    await po.setUp();
    const chatInput = po.chatActions.getChatInput();

    // Build an app so we have a preview with selectable components
    await po.sendPrompt("tc=basic");
    await po.previewPanel.clickTogglePreviewPanel();

    // Start a slow streaming response so subsequent messages get queued
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    // While streaming, select a component and queue a message with it
    await po.previewPanel.clickPreviewPickElement();
    await po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "Welcome to Your Blank App" })
      .click();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    await chatInput.fill("queued with component");
    await chatInput.press("Enter");
    await expect(po.page.getByText(/\d+ Queued/)).toBeVisible();

    // Edit the queued message — components should be restored
    const queuedRow = po.page.locator("li", {
      hasText: "queued with component",
    });
    await queuedRow.hover();
    await queuedRow.getByTitle("Edit").click();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    // Cancel the edit — components should be cleared
    await po.page.getByText("Cancel", { exact: true }).click();
    await expect(
      po.previewPanel.getSelectedComponentsDisplay(),
    ).not.toBeVisible();

    // Input should be empty after cancel
    await expect(chatInput).toBeEmpty();

    // Wait for the in-flight chat and the queued message to finish before ending the test
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();
  },
);
