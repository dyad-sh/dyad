import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("switching smart context mode saves the right setting", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });

  const beforeSettings1 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("balanced");
  await expect
    .poll(() => po.settings.recordSettings().proSmartContextOption)
    .toBe("balanced");
  po.settings.snapshotSettingsDelta(beforeSettings1);

  const beforeSettings2 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("off");
  await expect
    .poll(() => po.settings.recordSettings().enableProSmartFilesContextMode)
    .toBe(false);
  po.settings.snapshotSettingsDelta(beforeSettings2);

  const beforeSettings3 = po.settings.recordSettings();
  await proModesDialog.setSmartContextMode("deep");
  await expect
    .poll(() => po.settings.recordSettings().proSmartContextOption)
    .toBe("deep");
  po.settings.snapshotSettingsDelta(beforeSettings3);
});
