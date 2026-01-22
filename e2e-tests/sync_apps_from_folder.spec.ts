import path from "path";
import fs from "fs";
import { testWithConfig } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const test = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Create the dyad-apps directory with an untracked app
    const dyadAppsDir = path.join(userDataDir, "dyad-apps");
    const untrackedAppDir = path.join(dyadAppsDir, "untracked-test-app");
    fs.mkdirSync(untrackedAppDir, { recursive: true });

    // Copy the fixture package.json
    const fixtureDir = path.join(
      __dirname,
      "fixtures",
      "sync-app",
      "untracked-app",
    );
    fs.copyFileSync(
      path.join(fixtureDir, "package.json"),
      path.join(untrackedAppDir, "package.json"),
    );
  },
});

test("sync apps from folder - imports untracked app", async ({ po }) => {
  await po.setUp();

  // Navigate to Settings
  await po.goToSettingsTab();

  // Scroll to the Restore section and click Sync Apps
  await po.page
    .getByRole("heading", { name: "Restore" })
    .scrollIntoViewIfNeeded();
  await po.page.getByRole("button", { name: "Sync Apps" }).click();

  // Confirm the sync dialog
  await po.page.getByRole("button", { name: "Sync Apps" }).last().click();

  // Wait for success toast
  await po.waitForToastWithText("Successfully synced 1 app");

  // Navigate to Apps tab and verify the app appears
  await po.goToAppsTab();

  // Check that the synced app is visible in the app list
  await expect(
    po.getAppListItem({ appName: "untracked-test-app" }),
  ).toBeVisible();
});

test("sync apps from folder - no new apps message", async ({ po }) => {
  await po.setUp();

  // Navigate to Settings
  await po.goToSettingsTab();

  // Scroll to the Restore section and click Sync Apps
  await po.page
    .getByRole("heading", { name: "Restore" })
    .scrollIntoViewIfNeeded();
  await po.page.getByRole("button", { name: "Sync Apps" }).click();

  // Confirm the sync dialog
  await po.page.getByRole("button", { name: "Sync Apps" }).last().click();

  // Wait for success toast showing the app was synced
  await po.waitForToastWithText("Successfully synced 1 app");

  // Click sync again - this time no new apps should be found
  await po.page.getByRole("button", { name: "Sync Apps" }).click();

  // Confirm the sync dialog
  await po.page.getByRole("button", { name: "Sync Apps" }).last().click();

  // Should show "no new apps" message
  await po.waitForToastWithText("No new apps found to sync");
});
