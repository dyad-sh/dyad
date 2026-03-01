import { test } from "./helpers/test_helper";

test("switching smart context mode saves the right setting", async ({ po }) => {
  await po.setUpConeyPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });

  const beforeSettings1 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("balanced");
  po.settings.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("off");
  po.settings.snapshotSettingsDelta(beforeSettings2);

  const beforeSettings3 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("deep");
  po.settings.snapshotSettingsDelta(beforeSettings3);
});
