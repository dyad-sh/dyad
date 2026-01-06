import { test } from "./helpers/test_helper";

test("switching turbo edits saves the right setting", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });

  const beforeSettings1 = po.recordSettings();
  await proModesDialog.setTurboEditsMode("classic");
  po.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.recordSettings();
  await proModesDialog.setTurboEditsMode("search-replace");
  po.snapshotSettingsDelta(beforeSettings2);

  const beforeSettings3 = po.recordSettings();
  await proModesDialog.setTurboEditsMode("off");
  po.snapshotSettingsDelta(beforeSettings3);
});
