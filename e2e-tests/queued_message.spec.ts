import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("queued message gets added and sent after stream completes", async ({
  po,
}) => {
  await po.setUp();

  // Send a message with a medium sleep to simulate a slow response
  await po.sendPrompt("tc=first_message [sleep=medium]", {
    skipWaitForCompletion: true,
  });

  // Wait for chat input to appear (indicates we're in chat view and streaming)
  await expect(po.getChatInput()).toBeVisible();

  // While streaming, send another message - this should be queued
  await po.getChatInput().fill("tc=queued_message");
  await po.getChatInput().press("Enter");

  // Verify the queued message indicator is visible
  await expect(
    po.page.getByText("Queued - will send after current response"),
  ).toBeVisible();

  // Wait for the first stream to complete and the queued message to be sent
  await po.waitForChatCompletion();

  // Verify the queued message indicator is gone
  await expect(
    po.page.getByText("Queued - will send after current response"),
  ).not.toBeVisible();

  // Snapshot the messages to verify both messages were sent
  await po.snapshotMessages();
});
