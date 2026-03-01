import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("auto update - disable and enable", async ({ po }) => {
  await po.navigation.goToSettingsTab();

  const beforeSettings = po.settings.recordSettings();
  await po.settings.toggleAutoUpdate();
  await expect(
    po.page.getByRole("button", { name: "Restart Coney" }),
  ).toBeVisible();
  po.settings.snapshotSettingsDelta(beforeSettings);

  const beforeSettings2 = po.settings.recordSettings();
  await po.settings.toggleAutoUpdate();
  po.settings.snapshotSettingsDelta(beforeSettings2);
});
