import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("per-chat settings - mode is isolated between chats", async ({ po }) => {
  await po.setUpDyadPro({ autoApprove: true, localAgent: true });
  await po.importApp("minimal");

  // First chat: switch to Ask mode
  await po.selectChatMode("ask");

  // Verify Chat #1 shows Ask mode
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText("Ask");

  // Send a message in Ask mode to ensure the mode is persisted
  await po.sendPrompt("tc=local-agent/ask-read-file");
  await po.waitForChatCompletion();

  // Create a new chat
  await po.clickNewChat();

  // Change Chat #2 to Agent mode
  await po.selectChatMode("local-agent");
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Agent",
  );

  // Send a message in Chat #2 to ensure it's saved
  await po.sendPrompt("tc=local-agent/simple-response");
  await po.waitForChatCompletion();

  // Use the chat activity panel to navigate between chats
  await po.clickChatActivityButton();

  // Find and click Chat #1 (should be at index 1 since Chat #2 is most recent)
  const chat1ItemInList = po.page
    .locator('[data-testid^="chat-activity-list-item-"]')
    .filter({ hasText: "Chat #1" });
  await expect(chat1ItemInList).toBeVisible();
  await chat1ItemInList.click();

  // Chat #1 should still be in Ask mode (not affected by Chat #2's mode change)
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText("Ask");

  // Go back to Chat #2 through activity panel
  await po.clickChatActivityButton();

  // Find and click Chat #2 (now Chat #1 is most recent, so Chat #2 should be at a different index)
  const chat2ItemInList = po.page
    .locator('[data-testid^="chat-activity-list-item-"]')
    .filter({ hasText: "Chat #2" });
  await expect(chat2ItemInList).toBeVisible();
  await chat2ItemInList.click();

  // Chat #2 should still be in Agent mode (persisted its own setting)
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Agent",
  );
});
