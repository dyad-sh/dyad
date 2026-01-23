import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("turbo edits v2 - search-replace dump", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.setTurboEditsMode("search-replace");
  await proModesDialog.close();
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
  await po.snapshotServerDump("all-messages");
});

testSkipIfWindows("turbo edits v2 - search-replace approve", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await proModesDialog.setTurboEditsMode("search-replace");
  await proModesDialog.close();
  await po.sendPrompt("tc=turbo-edits-v2");
  await po.snapshotMessages();
  await po.approveProposal();
  await po.snapshotAppFiles({
    name: "after-search-replace",
    files: ["src/pages/Index.tsx"],
  });
});

testSkipIfWindows(
  "turbo edits v2 - search-replace fallback",
  async ({ po }) => {
    await po.setUpDyadPro();
    const proModesDialog = await po.openProModesDialog({
      location: "home-chat-input-container",
    });
    await proModesDialog.setTurboEditsMode("search-replace");
    await proModesDialog.close();
    await po.sendPrompt("tc=turbo-edits-v2-trigger-fallback");
    await po.snapshotServerDump("request");
    await po.snapshotMessages({ replaceDumpPath: true });
    await po.approveProposal();
    await po.snapshotAppFiles({
      name: "after-search-replace-fallback",
      files: ["src/pages/Index.tsx"],
    });
  },
);
