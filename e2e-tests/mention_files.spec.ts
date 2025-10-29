import { test } from "./helpers/test_helper";

test("mention file", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.importApp("minimal-with-ai-rules");
  await po.goToAppsTab();
  await po.getChatInput().click();
  await po.getChatInput().fill("[dump] @");
  await po.page.getByRole("menuitem", { name: "Choose AI_RULES.md" }).click();
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
});
