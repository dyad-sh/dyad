import { test } from "./helpers/test_helper";

test("switching smart context mode saves the right setting", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });

  const beforeSettings1 = po.recordSettings();
  await proModesDialog.setSmartContextMode("balanced");
  po.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.recordSettings();
  await proModesDialog.setSmartContextMode("off");
  po.snapshotSettingsDelta(beforeSettings2);

  const beforeSettings3 = po.recordSettings();
  await proModesDialog.setSmartContextMode("deep");
  po.snapshotSettingsDelta(beforeSettings3);
});
