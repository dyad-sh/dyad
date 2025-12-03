import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("smart context deep - read write read", async ({ po }) => {
  await po.setUpDyadPro({ autoApprove: true });
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.setSmartContextMode("deep");
  await proModesDialog.close();

  await po.sendPrompt("tc=read-index");
  await po.sendPrompt("tc=update-index-1");
  await po.sendPrompt("tc=read-index");
  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows(
  "smart context deep - mention app should fallback to balanced",
  async ({ po }) => {
    await po.setUpDyadPro();

    // First, create an imported app.
    await po.importApp("minimal-with-ai-rules");

    await po.goToAppsTab();
    const proModesDialog = await po.openProModesDialog({
      location: "home-chat-input-container",
    });
    await proModesDialog.setSmartContextMode("deep");
    await proModesDialog.close();

    // Mentioned the imported app
    await po.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

    await po.snapshotServerDump("request");
  },
);
