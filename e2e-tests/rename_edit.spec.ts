import { test } from "./helpers/test_helper";

test("rename then edit works", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("tc=rename-edit");
  await po.snapshotAppFiles({ name: "rename-edit" });
});
