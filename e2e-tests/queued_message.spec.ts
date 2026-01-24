import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("queued message gets added and sent after stream completes", async ({
  po,
}) => {
  await po.setUp();

  // Send a message with a medium sleep to simulate a slow response
  await po.sendPrompt("tc=1 [sleep=medium]", {
    skipWaitForCompletion: true,
  });

  // Wait for chat input to appear (indicates we're in chat view and streaming)
  await expect(po.getChatInput()).toBeVisible();

  // While streaming, send another message - this should be queued
  await po.getChatInput().fill("tc=2");
  await po.getChatInput().press("Enter");

  // Verify the queued message indicator is visible
  await expect(
    po.page.getByText("Queued - will send after current response"),
  ).toBeVisible();

  // Wait for the first stream to complete
  await po.waitForChatCompletion();

  // Verify the queued message indicator is gone (message is now being sent)
  await expect(
    po.page.getByText("Queued - will send after current response"),
  ).not.toBeVisible();

  // Wait for the queued message to also complete
  await po.waitForChatCompletion();

  // Verify both messages were sent by checking the message list
  const messagesList = po.page.locator('[data-testid="messages-list"]');
  await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
  await expect(messagesList.getByText("tc=2")).toBeVisible();
});
