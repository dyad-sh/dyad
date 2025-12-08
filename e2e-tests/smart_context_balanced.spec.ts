import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("smart context balanced - simple", async ({ po }) => {
  await po.setUpDyadPro({ autoApprove: true });
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.setSmartContextMode("balanced");
  await proModesDialog.close();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});
