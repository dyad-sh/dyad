import { test } from "./helpers/test_helper";

test("send message to ollama", async ({ po }) => {
  await po.modelPicker.selectTestOllamaModel();
  await po.chatActions.sendPrompt("hi");
  await po.snapshotMessages();
});
