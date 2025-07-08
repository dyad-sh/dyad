import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("release channel - change from stable to beta and back", async ({
  po,
}) => {
  await po.goToSettingsTab();

  // Change to beta channel
  await po.changeReleaseChannel("beta");
  await expect(
    po.page.getByRole("button", { name: "Restart Dyad" }),
  ).toBeVisible();
  await po.snapshotSettings();

  // Change back to stable channel
  await po.changeReleaseChannel("stable");
  await expect(
    po.page.getByRole("button", { name: "Download Stable" }),
  ).toBeVisible();
  await po.snapshotSettings();
});
