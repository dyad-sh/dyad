import { test } from "./helpers/test_helper";

test("switching turbo edits saves the right setting", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await po.snapshotSettings();
  await proModesDialog.setTurboEditsMode("classic");
  await po.snapshotSettings();
  await proModesDialog.setTurboEditsMode("search-replace");
  await po.snapshotSettings();
  await proModesDialog.setTurboEditsMode("off");
  await po.snapshotSettings();
});
