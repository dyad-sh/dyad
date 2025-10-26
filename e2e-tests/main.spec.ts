import { test } from "./helpers/test_helper";

test("simple message to custom test model", async ({ po }) => {
  console.time("simple message to custom test model");
  await po.setUp();
  await po.sendPrompt("hi");
  await po.snapshotMessages();
  console.timeEnd("simple message to custom test model");
});

test("basic message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.snapshotMessages();
});
