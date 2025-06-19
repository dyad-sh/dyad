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
