import fs from "fs";
import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("rename app (including folder)", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");

  const appPath = await po.getCurrentAppPath();
  await po.getTitleBarAppNameButton().click();

  await po.clickAppDetailsRenameAppButton();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("new-app-name");
  await po.page.getByRole("button", { name: "Continue" }).click();
  await po.page
    .getByRole("button", { name: "Recommended Rename app and" })
    .click();

  await expect(async () => {
    expect(await po.getCurrentAppName()).toBe("new-app-name");
  }).toPass();

  expect(fs.existsSync(appPath)).toBe(false);
  const newAppPath = po.getAppPath({ appName: "new-app-name" });
  expect(fs.existsSync(newAppPath)).toBe(true);

  await expect(po.page.getByText(newAppPath)).toBeVisible();
});

test("rename app (without folder)", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");

  const appPath = await po.getCurrentAppPath();
  await po.getTitleBarAppNameButton().click();

  await po.clickAppDetailsRenameAppButton();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("new-app-name");
  await po.page.getByRole("button", { name: "Continue" }).click();
  await po.page
    .getByRole("button", { name: "Rename app only The folder" })
    .click();

  await expect(async () => {
    expect(await po.getCurrentAppName()).toBe("new-app-name");
  }).toPass();

  expect(fs.existsSync(appPath)).toBe(true);
  await expect(po.page.getByText(appPath)).toBeVisible();
});
