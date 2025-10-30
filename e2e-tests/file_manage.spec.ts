import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("create and delete file from editor sidebar", async ({ po }) => {
  await po.setUp();
  await po.importApp("version-integrity");

  await po.clickTogglePreviewPanel();
  await po.selectPreviewMode("code");

  // Create a new file via the top-level plus button
  const newFileName = "new-file.txt";
  await po.page.once("dialog", async (dialog) => {
    await dialog.accept(newFileName);
  });
  // The header contains a single button (the "+" create button)
  await po.page.locator(".file-tree").getByRole("button").first().click();

  // Verify file appears in the sidebar
  await expect(po.page.getByText(newFileName)).toBeVisible();

  // Delete the file using the inline trash button on the file row
  await po.page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  const fileRow = po.page.locator("div", { hasText: newFileName }).first();
  await fileRow.hover();
  await fileRow.locator("button").first().click();

  // Verify the file disappears from the sidebar
  await expect(po.page.getByText(newFileName)).toBeHidden();
});


