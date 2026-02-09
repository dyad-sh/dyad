import { test } from "./helpers/test_helper";

test("mention app (without pro)", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.appManagement.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("all-messages");
});

test("mention app (with pro)", async ({ po }) => {
  await po.setUpDyadPro();

  await po.appManagement.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.selectChatMode("build");
  await po.chatActions.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("request");
});
