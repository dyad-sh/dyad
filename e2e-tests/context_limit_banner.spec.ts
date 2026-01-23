import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("context limit banner appears and summarize works", async ({ po }) => {
  await po.setUp();

  // Send a message that triggers high token usage (110k tokens)
  // With a default context window of 128k, this leaves only 18k tokens remaining
  // which is below the 40k threshold to show the banner
  await po.sendPrompt("tc=context-limit-response [high-tokens=110000]");

  // Verify the context limit banner appears
  const contextLimitBanner = po.page.getByTestId("context-limit-banner");
  await expect(contextLimitBanner).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify banner text
  await expect(contextLimitBanner).toContainText(
    "You're close to the context limit for this chat.",
  );

  // Click the summarize button
  await contextLimitBanner
    .getByRole("button", { name: "Summarize into new chat" })
    .click();

  // Wait for the new chat to load and message to complete
  await po.waitForChatCompletion();

  // Snapshot the messages in the new chat
  await po.snapshotMessages();
});

test("context limit banner does not appear when within limit", async ({
  po,
}) => {
  await po.setUp();

  // Send a message with low token usage (50k tokens)
  // With a 128k context window, this leaves 78k tokens remaining
  // which is above the 40k threshold - banner should NOT appear
  await po.sendPrompt("tc=context-limit-response [high-tokens=50000]");

  // Verify the context limit banner does NOT appear
  const contextLimitBanner = po.page.getByTestId("context-limit-banner");
  await expect(contextLimitBanner).not.toBeVisible();
});
