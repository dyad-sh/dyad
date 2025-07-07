import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("auto update - disable and enable", async ({ po }) => {
  await po.goToSettingsTab();

  await po.toggleAutoUpdate();
  await expect(
    po.page.getByRole("button", { name: "Restart Dyad" }),
  ).toBeVisible();
  await po.snapshotSettings();

  await po.toggleAutoUpdate();
  await po.snapshotSettings();
});
