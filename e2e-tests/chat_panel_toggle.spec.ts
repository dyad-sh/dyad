import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("toggle chat panel visibility", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  // We are in the chat view after setUp
  await po.sendPrompt("basic");

  // Chat panel should be visible initially.
  const chatPanel = po.page.locator("#chat-panel");
  await expect(chatPanel).toBeVisible();

  // Toggle button
  const toggleButton = po.page.getByTestId("preview-toggle-chat-panel-button");
  // Collapse
  await toggleButton.click();

  await expect(chatPanel).toBeHidden();

  // Expand
  await toggleButton.click();

  // Expect chat panel to be visible
  await expect(chatPanel).toBeVisible();
});
