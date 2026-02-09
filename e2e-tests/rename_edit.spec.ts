import { test } from "./helpers/test_helper";

test("rename then edit works", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.appManagement.importApp("minimal");

  await po.chatActions.sendPrompt("tc=rename-edit");
  await po.snapshotAppFiles({ name: "rename-edit" });
});
