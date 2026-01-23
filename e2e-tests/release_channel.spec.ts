import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("release channel - change from stable to beta and back", async ({
  po,
}) => {
  await po.goToSettingsTab();

  // Change to beta channel
  const beforeSettings1 = po.recordSettings();
  await po.changeReleaseChannel("beta");
  await expect(
    po.page.getByRole("button", { name: "Restart Dyad" }),
  ).toBeVisible();
  po.snapshotSettingsDelta(beforeSettings1);

  // Change back to stable channel
  const beforeSettings2 = po.recordSettings();
  await po.changeReleaseChannel("stable");
  await expect(
    po.page.getByRole("button", { name: "Download Stable" }),
  ).toBeVisible();
  po.snapshotSettingsDelta(beforeSettings2);
});
