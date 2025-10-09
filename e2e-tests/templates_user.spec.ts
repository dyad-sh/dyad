import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import path from "path";

// E2E: Your templates section - add and delete user template

test("hub: your templates section supports add and delete", async ({ po }) => {
  await po.goToHubTab();

  // Open AddUserTemplateDialog by selecting the "Import your own template" card
  // Stub select folder dialog to a known fixture directory
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [path.join(__dirname, "fixtures", "import-app", "app-basic")],
  });

  // Click the card image by accessible name
  await po.page.getByRole("img", { name: "Import your own template" }).click();

  // In the dialog, click Select Folder (will use stubbed path)
  await po.page.getByRole("button", { name: "Select Folder" }).click();

  // Title auto-fills from folder; save
  await po.page.getByRole("button", { name: "Save to Hub" }).click();

  // Verify the new template appears under "Your templates" section
  const yourSection = po.page.getByRole("region", { name: "your-templates" });
  await expect(yourSection).toBeVisible();
  await expect(
    yourSection.getByRole("img", { name: /app-basic/i })
  ).toBeVisible();

  // Select the user template to ensure it's selectable
  await yourSection.getByRole("img", { name: /app-basic/i }).click();

  // Delete the user template
  await yourSection
    .getByRole("img", { name: /app-basic/i })
    .locator("xpath=ancestor::*[@class][1]")
    .getByRole("button", { name: "Delete template" })
    .click();

  // Verify it's removed
  await expect(
    yourSection.getByRole("img", { name: /app-basic/i })
  ).toBeHidden();
});
