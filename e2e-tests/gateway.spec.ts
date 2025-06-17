import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("gemini 2.5 flash", async ({ po }) => {
  // Note: we do not need to disable pro modes because 2.5 flash doesn't
  // use engine.
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Flash" });
  await po.sendPrompt("[dump] tc=gateway-simple");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows("claude 4 sonnet", async ({ po }) => {
  await po.setUpDyadPro();
  // Disable the pro modes so it routes to gateway.
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.toggleTurboEdits();
  await proModesDialog.toggleSmartContext();
  await proModesDialog.close();

  await po.selectModel({ provider: "Anthropic", model: "Claude 4 Sonnet" });

  await po.sendPrompt("[dump] tc=gateway-simple");

  await po.snapshotServerDump("request");
});
