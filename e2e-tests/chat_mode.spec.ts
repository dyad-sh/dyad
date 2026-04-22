import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("chat mode selector - default build mode", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("[dump] hi");
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("chat mode selector - ask mode", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.chatActions.selectChatMode("ask");
  await po.sendPrompt("[dump] hi");
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
  await po.snapshotMessages({ replaceDumpPath: true });
});

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

test.skip("dyadwrite edit and save - basic flow", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.chatActions.clickNewChat();

  await po.sendPrompt(
    "Create a simple React component in src/components/Hello.tsx",
  );
  await po.chatActions.waitForChatCompletion();

  await po.codeEditor.clickEditButton();
  await po.codeEditor.editFileContent("// Test modification\n");

  await po.codeEditor.saveFile();

  await po.snapshotMessages({ replaceDumpPath: true });
});
