import fs from "fs";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("bulk delete apps from gallery", async ({ po }) => {
  await po.setUp();

  // Create 3 apps.
  const appDetails: { appName: string; appPath: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    if (i > 1) {
      await po.navigation.goToAppsTab();
    }
    await po.sendPrompt("hi");
    const appName = await po.appManagement.getCurrentAppName();
    if (!appName) throw new Error(`App ${i} name not found`);
    const appPath = po.appManagement.getAppPath({ appName });
    appDetails.push({ appName, appPath });
  }
  const [
    { appName: appName1, appPath: appPath1 },
    { appName: appName2, appPath: appPath2 },
    { appName: appName3, appPath: appPath3 },
  ] = appDetails;

  // Navigate to the gallery via "See more" on the home page.
  await po.navigation.goToAppsTab();
  await po.page.getByRole("button", { name: "See more" }).first().click();

  // All three cards should be visible.
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName1}`),
  ).toBeVisible();
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName2}`),
  ).toBeVisible();
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName3}`),
  ).toBeVisible();

  // Enter selection mode.
  await po.page.getByTestId("apps-gallery-select-button").click();
  await expect(
    po.page.getByTestId("apps-gallery-selection-toolbar"),
  ).toBeVisible();

  // Select the first two apps.
  await po.page.getByTestId(`app-showcase-card-${appName1}`).click();
  await po.page.getByTestId(`app-showcase-card-${appName2}`).click();
  await expect(po.page.getByTestId("apps-gallery-selection-count")).toHaveText(
    "2",
  );

  // Click delete and confirm.
  await po.page.getByTestId("apps-gallery-bulk-delete-button").click();
  await po.page.getByTestId("apps-gallery-bulk-delete-confirm-button").click();

  // Selection mode should exit after a successful bulk delete.
  await expect(
    po.page.getByTestId("apps-gallery-selection-toolbar"),
  ).not.toBeVisible();

  // The two deleted apps should be gone from the gallery and disk.
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName1}`),
  ).not.toBeVisible();
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName2}`),
  ).not.toBeVisible();
  expect(fs.existsSync(appPath1)).toBe(false);
  expect(fs.existsSync(appPath2)).toBe(false);

  // The third app must still be present.
  await expect(
    po.page.getByTestId(`app-showcase-card-${appName3}`),
  ).toBeVisible();
  expect(fs.existsSync(appPath3)).toBe(true);
});
