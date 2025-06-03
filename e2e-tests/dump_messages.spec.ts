import { testSkipIfWindows } from "./helpers/test_helper";

// This is useful to make sure the messages are being sent correctly.
//
// Why skip on Windows? The file ordering is not stable between runs
// but unclear why.
testSkipIfWindows("dump messages", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump();
});
