import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import * as eph from "electron-playwright-helpers";

test("new apps are stored in the user's custom folder", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToSettingsTab();

  const defaultBasePath = path.join(po.userDataDir, "dyad-apps");
  const newBasePath = path.join(po.userDataDir, "alt-app-storage");

  if (!fs.existsSync(newBasePath)) {
    fs.mkdirSync(newBasePath, { recursive: true });
  }

  const browseButton = po.page.getByTestId("customize-apps-folder-button");

  // Stub the file dialog to return the new base path BEFORE clicking the button
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [newBasePath],
  });
  await browseButton.click();

  // Create new app after customizing directory path
  await po.navigation.goToAppsTab();
  await po.sendPrompt("hello");

  const appName = await po.appManagement.getCurrentAppName();

  expect(appName).toBeTruthy();

  // The app should be in the custom directory, not the default
  expect(fs.existsSync(path.join(newBasePath, appName!))).toBe(true);
  expect(fs.existsSync(path.join(defaultBasePath, appName!))).toBe(false);
});

test("store apps in default folder after resetting path", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToSettingsTab();

  const defaultBasePath = path.join(po.userDataDir, "dyad-apps");
  const newBasePath = path.join(po.userDataDir, "alt-app-storage");

  if (!fs.existsSync(newBasePath)) {
    fs.mkdirSync(newBasePath, { recursive: true });
  }

  const browseButton = po.page.getByTestId("customize-apps-folder-button");

  // Customize directory path
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [newBasePath],
  });
  await browseButton.click();

  // Immediately reset directory path to default
  const resetButton = po.page.getByRole("button", {
    name: /Reset to Default/i,
  });

  await expect(resetButton).toBeVisible();
  await resetButton.click();

  // Create an app under the default path
  await po.navigation.goToAppsTab();
  await po.sendPrompt("hello");

  const appName = await po.appManagement.getCurrentAppName();

  expect(appName).toBeTruthy();

  // App should be located under the default path
  expect(fs.existsSync(path.join(newBasePath, appName!))).toBe(false);
  expect(fs.existsSync(path.join(defaultBasePath, appName!))).toBe(true);
});

test("custom folder change doesn't make apps inaccessible", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToSettingsTab();

  const defaultBasePath = path.join(po.userDataDir, "dyad-apps");
  const newBasePath = path.join(po.userDataDir, "alt-app-storage");

  if (!fs.existsSync(newBasePath)) {
    fs.mkdirSync(newBasePath, { recursive: true });
  }

  const browseButton = po.page.getByTestId("customize-apps-folder-button");

  // Customize directory path
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [newBasePath],
  });
  await browseButton.click();

  // Create an app under the custom path
  await po.navigation.goToAppsTab();
  await po.sendPrompt("hello");
  const appName = await po.appManagement.getCurrentAppName();

  expect(appName).toBeTruthy();

  // Reset directory path to default
  await po.navigation.goToSettingsTab();
  const resetButton = po.page.getByRole("button", {
    name: /Reset to Default/i,
  });
  await resetButton.click();

  await po.navigation.goToAppsTab();
  await po.appManagement.clickAppListItem({ appName: appName! });
  await po.appManagement.clickOpenInChatButton();

  // Should be able to start up app; if we can't then we'll see an error
  let toast;
  try {
    toast = await po.page.waitForSelector(
      `[data-sonner-toast]:has-text("Error")`,
      {
        timeout: Timeout.SHORT,
      },
    );
  } catch {
    // Fall through
  }

  expect(toast).toBe(undefined);

  const appPathIfCustom = path.join(newBasePath, appName!);
  const appPathIfDefault = path.join(defaultBasePath, appName!);

  // App should still be located in the custom directory
  expect(fs.existsSync(appPathIfCustom)).toBe(true);
  expect(fs.existsSync(appPathIfDefault)).toBe(false);
});
