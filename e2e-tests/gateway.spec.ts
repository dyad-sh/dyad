import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("claude 4 sonnet", async ({ po }) => {
  await po.setUpDyadPro();
  // Disable the pro modes so it routes to gateway.
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.toggleTurboEdits();
  await proModesDialog.setSmartContextMode("off");
  await proModesDialog.close();

  await po.selectModel({ provider: "Anthropic", model: "Claude 4 Sonnet" });

  await po.sendPrompt("[dump] tc=gateway-simple");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});
