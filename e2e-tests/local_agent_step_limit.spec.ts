import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for the step limit feature.
 * When the local agent hits 50 tool call steps, it pauses and shows
 * a <dyad-step-limit> notification card.
 */

testSkipIfWindows("local-agent - step limit pause", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/step-limit", {
    skipWaitForCompletion: true,
  });

  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("tc=local-agent/simple-response");
  await chatInput.press("Enter");

  // Verify the step limit card is visible
  await expect(
    po.page.getByText("Paused after 100 tool calls", { exact: true }),
  ).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });

  await expect(po.page.getByText("1 Queued")).toBeVisible();
  await expect(po.page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(
    po.page
      .locator('[data-testid="messages-list"]')
      .getByText("tc=local-agent/simple-response"),
  ).not.toBeVisible();

  const queuedRow = po.page.locator("li", {
    hasText: "tc=local-agent/simple-response",
  });
  await queuedRow.hover();
  await queuedRow.getByTitle("Delete").click();

  // Verify the "Continue" button is shown
  await expect(po.page.getByRole("button", { name: "Continue" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Click the "Continue" button
  await po.page.getByRole("button", { name: "Continue" }).click();

  await po.snapshotMessages();
});
