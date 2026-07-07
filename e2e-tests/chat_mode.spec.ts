import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// Build/ask-mode payload coverage lives in the vitest hybrid suite
// (chat_mode.integration.test.ts), which asserts the LLM request payloads and
// db effects directly. This spec keeps the per-chat persistence flow, which
// exercises chat tabs — app-shell surface the hybrid harness does not mount.
test("chat mode selector - mode persists per chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  const selector = po.page.getByTestId("chat-mode-selector");

  await po.sendPrompt("[dump] first chat setup");
  await po.chatActions.waitForChatCompletion();

  await po.chatActions.selectChatMode("ask");
  await expect(selector).toContainText("Ask");

  await po.chatActions.clickNewChat();
  await expect(selector).not.toContainText("Ask");

  await po.chatActions.selectChatMode("plan");
  await expect(selector).toContainText("Plan");

  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab.locator("button").first().click();
  await expect(selector).toContainText("Ask");

  const inactiveTab2 = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab2.locator("button").first().click();
  await expect(selector).toContainText("Plan");
});
