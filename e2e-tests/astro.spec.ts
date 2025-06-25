import { test } from "./helpers/test_helper";

test("astro", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("astro");

  await po.sendPrompt("[dump] hi");

  await po.snapshotServerDump("all-messages");
});
