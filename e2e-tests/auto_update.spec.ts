import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("auto update - disable and enable", async ({ po }) => {
  await po.goToSettingsTab();

  const beforeSettings = po.recordSettings();
  await po.toggleAutoUpdate();
  await expect(
    po.page.getByRole("button", { name: "Restart Dyad" }),
  ).toBeVisible();
  po.snapshotSettingsDelta(beforeSettings);

  const beforeSettings2 = po.recordSettings();
  await po.toggleAutoUpdate();
  po.snapshotSettingsDelta(beforeSettings2);
});
