import fs from "fs";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// This test fails consistently on Windows (in sharded mode).
// Most likely because deleting the files is causing an issue
// with Window's aggressive file locking.
testSkipIfWindows("delete app", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  const appName = await po.getCurrentAppName();
  if (!appName) {
    throw new Error("App name not found");
  }
  const appPath = await po.getCurrentAppPath();
  await po.getTitleBarAppNameButton().click();
  await expect(po.getAppListItem({ appName })).toBeVisible();

  // Delete app
  await po.clickAppDetailsMoreOptions();
  // Open delete dialog
  await po.page.getByRole("button", { name: "Delete" }).click();
  // Confirm delete
  await po.page.getByRole("button", { name: "Delete App" }).click();

  // Make sure the app is deleted
  await po.isCurrentAppNameNone();
  expect(fs.existsSync(appPath)).toBe(false);
  expect(po.getAppListItem({ appName })).not.toBeVisible();
});
