import { test } from "./helpers/test_helper";

// This is useful to make sure the messages are being sent correctly.
test("dump messages", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump();
});
