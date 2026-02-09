import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("dyad tags handles nested < tags", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.appManagement.importApp("minimal");
  await po.chatActions.sendPrompt("tc=dyad-write-angle");
  await po.snapshotAppFiles({ name: "angle-tags-handled" });
});
