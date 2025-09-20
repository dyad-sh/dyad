import { test } from "./helpers/test_helper";

test("chat mode selector - default build mode", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("[dump] hi");
  await po.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("chat mode selector - ask mode", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.selectChatMode("ask");
  await po.sendPrompt("[dump] hi");
  await po.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("dyadwrite edit and save - basic flow", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.clickNewChat();

  await po.sendPrompt(
    "Create a simple React component in src/components/Hello.tsx",
  );
  await po.waitForChatCompletion();

  await po.clickEditButton();
  await po.editFileContent("// Test modification\n");

  await po.saveFile();

  await po.snapshotMessages({ replaceDumpPath: true });
});

test("dyadwrite edit and cancel", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.clickNewChat();

  await po.sendPrompt("Create a utility function in src/utils/helper.ts");
  await po.waitForChatCompletion();

  await po.clickEditButton();

  await po.editFileContent("// This should be discarded\n");
  await po.cancelEdit();

  await po.snapshotMessages({ replaceDumpPath: true });
});
