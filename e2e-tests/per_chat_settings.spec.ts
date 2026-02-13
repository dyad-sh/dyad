import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("per-chat settings - mode is isolated between chats", async ({ po }) => {
  await po.setUpDyadPro({ autoApprove: true, localAgent: true });
  await po.importApp("minimal");

  // First chat: switch to Ask mode
  await po.chatActions.selectChatMode("ask");

  // Verify Chat #1 shows Ask mode
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText("Ask");

  // Send a message in Ask mode to ensure the mode is persisted
  await po.sendPrompt("tc=local-agent/ask-read-file");
  await po.chatActions.waitForChatCompletion();

  // Create a new chat
  await po.chatActions.clickNewChat();

  // Change Chat #2 to Agent mode
  await po.chatActions.selectChatMode("local-agent");
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Agent",
  );

  // Send a message in Chat #2 to ensure it's saved
  await po.sendPrompt("tc=local-agent/simple-response");
  await po.chatActions.waitForChatCompletion();

  // Wait for tabs to appear (at least 2 tabs should exist now)
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 10000 });

  // Switch back to Chat #1 by clicking the inactive tab
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') })
    .first();

  await expect(inactiveTab).toBeVisible();
  await inactiveTab.locator("button").first().click();

  // Chat #1 should still be in Ask mode (not affected by Chat #2's mode change)
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText("Ask");

  // Switch back to Chat #2 - find the tab that's now inactive (should be Chat #2)
  const chat2Tab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') })
    .first();

  await expect(chat2Tab).toBeVisible();
  await chat2Tab.locator("button").first().click();

  // Chat #2 should still be in Agent mode (persisted its own setting)
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Agent",
  );
});
