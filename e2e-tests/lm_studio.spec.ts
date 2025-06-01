import { test } from "./helpers/test_helper";

test("send message to LM studio", async ({ po }) => {
  await po.selectTestLMStudioModel();
  await po.sendPrompt("hi");
  await po.snapshotMessages();
});
