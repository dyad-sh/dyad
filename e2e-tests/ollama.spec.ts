import { test } from "./helpers/test_helper";

test("send message to ollama", async ({ po }) => {
  await po.selectTestOllamaModel();
  await po.sendPrompt("hi");
  await po.snapshotMessages();
});
