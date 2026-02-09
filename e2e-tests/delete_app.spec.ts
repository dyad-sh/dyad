import fs from "fs";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("delete app", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("hi");
  const appName = await po.appManagement.getCurrentAppName();
  if (!appName) {
    throw new Error("App name not found");
  }
  const appPath = await po.appManagement.getCurrentAppPath();
  await po.appManagement.getTitleBarAppNameButton().click();
  await expect(po.appManagement.getAppListItem({ appName })).toBeVisible();

  // Delete app
  await po.appManagement.clickAppDetailsMoreOptions();
  // Open delete dialog
  await po.page.getByRole("button", { name: "Delete" }).click();
  // Confirm delete
  await po.page.getByRole("button", { name: "Delete App" }).click();

  // Make sure the app is deleted
  await po.appManagement.isCurrentAppNameNone();
  expect(fs.existsSync(appPath)).toBe(false);
  await expect(po.appManagement.getAppListItem({ appName })).not.toBeVisible();
});
