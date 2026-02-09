import { test } from "./helpers/test_helper";

test("astro", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.appManagement.importApp("astro");

  await po.chatActions.sendPrompt("[dump] hi");

  await po.snapshotServerDump("all-messages");
});
