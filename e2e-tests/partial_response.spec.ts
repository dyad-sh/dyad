import { test } from "./helpers/test_helper";

test("partial message is resumed", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.appManagement.importApp("minimal");
  await po.chatActions.sendPrompt("tc=partial-write");

  // This is a special test case which triggers a dump.
  await po.snapshotServerDump("all-messages");
  await po.snapshotMessages({ replaceDumpPath: true });
  await po.snapshotAppFiles({ name: "message-resumed" });
});
