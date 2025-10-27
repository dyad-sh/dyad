import { test } from "./helpers/test_helper";

test("mention file", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.importApp("minimal-with-ai-rules");
  await po.goToAppsTab();
  await po.sendPrompt("[dump] @file:AI_RULES.md hi");

  await po.snapshotServerDump("all-messages");
});
