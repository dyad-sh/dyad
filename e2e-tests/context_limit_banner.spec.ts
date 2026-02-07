import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("context limit banner shows 'running out' when near context limit", async ({
  po,
}) => {
  await po.setUp();

  // Send a message that triggers high token usage (110k tokens)
  // With a default context window of 128k, this leaves only 18k tokens remaining
  // which is below the 40k threshold to show the banner
  await po.sendPrompt("tc=context-limit-response [high-tokens=110000]");

  // Verify the context limit banner appears inside the chat input container
  const contextLimitBanner = po
    .getChatInputContainer()
    .getByTestId("context-limit-banner");
  await expect(contextLimitBanner).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify banner text for near-limit case
  await expect(contextLimitBanner).toContainText(
    "This chat context is running out",
  );

  // Click the summarize button
  await contextLimitBanner.getByRole("button", { name: "Summarize" }).click();

  // Wait for the new chat to load and message to complete
  await po.waitForChatCompletion();

  // Snapshot the messages in the new chat
  await po.snapshotMessages();
});

test("context limit banner shows 'costs extra' for long context", async ({
  po,
}) => {
  await po.setUp();

  // Add a custom test model with a 1M context window so 250k tokens isn't "near limit"
  await po.goToSettingsTab();
  await po.addCustomTestModel({
    name: "test-model-large-ctx",
    contextWindow: 1_000_000,
  });
  await po.goToAppsTab();
  await po.selectModel({
    provider: "test-provider",
    model: "test-model-large-ctx",
  });

  // Send a message with 250k tokens (above 200k threshold)
  // With 1M context window, 750k tokens remaining > 40k threshold, so not "near limit"
  await po.sendPrompt("tc=context-limit-response [high-tokens=250000]");

  // Verify the context limit banner appears inside the chat input container
  const contextLimitBanner = po
    .getChatInputContainer()
    .getByTestId("context-limit-banner");
  await expect(contextLimitBanner).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify banner text for long context case
  await expect(contextLimitBanner).toContainText(
    "Long chat context costs extra",
  );
});

test("context limit banner does not appear when within limit", async ({
  po,
}) => {
  await po.setUp();

  // Send a message with low token usage (50k tokens)
  // With a 128k context window, this leaves 78k tokens remaining
  // which is above the 40k threshold AND below 200k - banner should NOT appear
  await po.sendPrompt("tc=context-limit-response [high-tokens=50000]");

  // Verify the context limit banner does NOT appear in the chat input container
  const contextLimitBanner = po
    .getChatInputContainer()
    .getByTestId("context-limit-banner");
  await expect(contextLimitBanner).not.toBeVisible();
});
