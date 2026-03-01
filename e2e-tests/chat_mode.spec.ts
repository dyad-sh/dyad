import { test } from "./helpers/test_helper";

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

test.skip("coneywrite edit and save - basic flow", async ({ po }) => {
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
