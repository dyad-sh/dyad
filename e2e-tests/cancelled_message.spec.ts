import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";

test("cancelled message shows cancelled indicator and is kept in context", async ({
  po,
}) => {
  await po.setUp();

  // Send a message with a slow response so we have time to cancel
  await po.sendPrompt("tc=cancelled-test [sleep=medium]", {
    skipWaitForCompletion: true,
  });

  // Click the cancel generation button
  await po.page.getByRole("button", { name: "Cancel generation" }).click();

  // Wait for streaming to stop (Retry button appears)
  await po.chatActions.waitForChatCompletion();

  // Verify the "Cancelled" indicators are visible (one on user msg, one on assistant msg)
  const messagesList = po.page.getByTestId("messages-list");
  const cancelledIndicators = messagesList.getByText("Cancelled", {
    exact: true,
  });
  await expect(cancelledIndicators).toHaveCount(2);

  // Send a follow-up message with [dump] to capture what gets sent to the LLM
  await po.sendPrompt("[dump] tc=follow-up");

  // The follow-up should be visible
  await expect(messagesList.getByText("tc=follow-up")).toBeVisible();

  // Cancelled indicators should still be visible (messages stay in UI)
  await expect(cancelledIndicators).toHaveCount(2);

  // Read the server dump to verify the cancelled message (and the user prompt
  // that triggered it) ARE kept in the context sent to the LLM.
  const messagesListText = await messagesList.textContent();
  const dumpPathMatch = messagesListText?.match(
    /\[\[dyad-dump-path=([^\]]+)\]\]/,
  );
  expect(dumpPathMatch).toBeTruthy();
  const dumpContent = fs.readFileSync(dumpPathMatch![1], "utf-8");
  expect(dumpContent).toContain("tc=cancelled-test");
  expect(dumpContent).toContain("Response cancelled by user");
});
