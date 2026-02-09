import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("mention file", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.getChatInput().click();
  // Use pressSequentially so the mention trigger (@) is properly detected by Lexical
  await po.chatActions.getChatInput().pressSequentially("[dump] @");
  // Wait for the mention menu to appear
  const menuItem = po.page.getByRole("menuitem", {
    name: "Choose AI_RULES.md",
  });
  await expect(menuItem).toBeVisible({ timeout: Timeout.MEDIUM });
  await menuItem.click();
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
});
