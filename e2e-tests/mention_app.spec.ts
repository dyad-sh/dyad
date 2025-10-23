import { test } from "./helpers/test_helper";

test("mention app (without pro)", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.importApp("minimal-with-ai-rules");
  await po.goToAppsTab();
  await po.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("all-messages");
});

test("mention app (with pro)", async ({ po }) => {
  await po.setUpDyadPro();

  await po.importApp("minimal-with-ai-rules");
  await po.goToAppsTab();
  await po.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("request");
});
