import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import * as eph from "electron-playwright-helpers";

test("move app to a custom storage location", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hello");

  const appName = await po.getCurrentAppName();
  const originalPath = await po.getCurrentAppPath();

  await po.getTitleBarAppNameButton().click();

  const newBasePath = path.join(po.userDataDir, "alt-app-storage");
  if (!fs.existsSync(newBasePath)) {
    fs.mkdirSync(newBasePath, { recursive: true });
  }

  // Stub the file dialog to return the new base path BEFORE clicking the button
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [newBasePath],
  });

  // Click the "Change location" button
  await po.page.getByRole("button", { name: "Change location" }).click();

  // Wait for the dialog to be visible and click "Select Folder" button
  const selectFolderButton = po.page
    .getByRole("dialog")
    .getByRole("button", { name: "Select Folder" });
  await expect(selectFolderButton).toBeVisible();
  await selectFolderButton.click();

  // Wait for the move operation to complete (button shows "Moving..." then dialog closes)
  await expect(selectFolderButton).not.toBeVisible({ timeout: 30000 });

  const newAppPath = path.join(newBasePath, appName ?? "");

  await expect(async () => {
    expect(fs.existsSync(newAppPath)).toBe(true);
    expect(fs.existsSync(originalPath)).toBe(false);
    await expect(
      po.page
        .locator("span.text-sm.break-all")
        .filter({ hasText: newAppPath })
        .first(),
    ).toBeVisible();
  }).toPass();
});
