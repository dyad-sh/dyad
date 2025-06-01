import { test } from "./helpers/test_helper";

test("retry - should work", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("[increment]");
  await po.snapshotMessages();

  await po.dismissAllToasts();
  await po.clickRetry();
  await po.expectNoToast();
  // The counter should be incremented in the snapshotted messages.
  await po.snapshotMessages();
});
