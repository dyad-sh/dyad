import { test } from "./helpers/test_helper";

test("simple message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("hi");
  await po.snapshotMessages();
});

test("basic message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("tc=basic");
  await po.snapshotMessages();
});
