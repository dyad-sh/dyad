import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("release channel - change from stable to beta and back", async ({
  po,
}) => {
  await po.navigation.goToSettingsTab();

  // Change to beta channel
  const beforeSettings1 = po.settings.recordSettings();
  await po.settings.changeReleaseChannel("beta");
  await expect(
    po.page.getByRole("button", { name: "Restart Coney" }),
  ).toBeVisible();
  po.settings.snapshotSettingsDelta(beforeSettings1);

  // Change back to stable channel
  const beforeSettings2 = po.settings.recordSettings();
  await po.settings.changeReleaseChannel("stable");
  await expect(
    po.page.getByRole("button", { name: "Download Stable" }),
  ).toBeVisible();
  po.settings.snapshotSettingsDelta(beforeSettings2);
});
