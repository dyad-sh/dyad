import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("toggle chat panel visibility", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  // We are in the chat view after setUp
  await po.sendPrompt("basic");

  // Chat panel content should be visible initially.
  // We check the ChatPanel content rather than the panel container itself,
  // since the container is always present but resized to 1% when collapsed.
  const chatPanelContent = po.page.getByTestId("messages-list");
  await expect(chatPanelContent).toBeVisible();

  // Toggle button
  const toggleButton = po.page.getByTestId("preview-toggle-chat-panel-button");
  // Collapse
  await toggleButton.click();

  // When collapsed, the ChatPanel component is not rendered (isChatPanelHidden = true)
  await expect(chatPanelContent).toBeHidden();

  // Expand
  await toggleButton.click();

  // Expect chat panel content to be visible again
  await expect(chatPanelContent).toBeVisible();
});
