import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

test("custom template - add, select, delete", async ({ po }) => {
  // Create a temporary folder to use as a custom template
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-custom-template-"));
  
  // Create a simple index.html in the temp folder to make it a valid template
  fs.writeFileSync(
    path.join(tempDir, "index.html"),
    "<html><body>Custom Template Test</body></html>",
  );
  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({ name: "custom-template-test", version: "1.0.0" }),
  );

  try {
    await po.goToHubTab();

    // Initially, "Your templates" section should show empty state
    await expect(
      po.page.getByText("No custom templates yet"),
    ).toBeVisible();

    // Click "Add Your First Template" button
    await po.page
      .getByRole("button", { name: "Add Your First Template" })
      .click();

    // Dialog should be visible
    await expect(
      po.page.getByRole("heading", { name: "Add Custom Template" }),
    ).toBeVisible();

    // Fill in template details
    await po.page.getByLabel("Template Name").fill("Test Custom Template");
    await po.page
      .getByLabel("Description")
      .fill("A test template for E2E testing");

    // Mock the folder selection dialog
    await po.electronApp.evaluate(
      async ({ dialog }, folderPath) => {
        // Mock dialog.showOpenDialog to return our temp directory
        const originalShowOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folderPath],
        });
        // Restore after one call
        setTimeout(() => {
          dialog.showOpenDialog = originalShowOpenDialog;
        }, 100);
      },
      tempDir,
    );

    // Click browse button to trigger folder selection
    await po.page.getByRole("button", { name: "Browse" }).click();

    // Wait a bit for the mock to work
    await po.page.waitForTimeout(200);

    // Verify folder path is set
    await expect(po.page.getByPlaceholder("Select a folder...")).toHaveValue(
      tempDir,
    );

    // Submit the form
    await po.page.getByRole("button", { name: "Add Template" }).click();

    // Wait for success message and dialog to close
    await po.page.waitForTimeout(1000);

    // Verify the custom template appears in the list
    await expect(
      po.page.getByRole("heading", { name: "Test Custom Template" }),
    ).toBeVisible();

    // Select the custom template
    await po.page.getByRole("img", { name: "Test Custom Template" }).click();

    // Verify it's selected
    await expect(po.page.getByText("Selected")).toBeVisible();

    // Snapshot settings to verify the custom template is stored
    await po.snapshotSettings();

    // Hover over the template card to reveal delete button
    await po.page.getByRole("img", { name: "Test Custom Template" }).hover();

    // Click delete button
    await po.page
      .getByRole("button", { title: "Delete custom template" })
      .click();

    // Confirm deletion in the browser confirm dialog
    po.page.on("dialog", async (dialog) => {
      expect(dialog.message()).toContain(
        'Are you sure you want to delete "Test Custom Template"',
      );
      await dialog.accept();
    });

    // Wait for deletion to complete
    await po.page.waitForTimeout(1000);

    // Verify the template is removed and empty state is shown again
    await expect(
      po.page.getByText("No custom templates yet"),
    ).toBeVisible();

    // Snapshot settings to verify the custom template is removed
    await po.snapshotSettings();
  } finally {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("custom template - create app from custom template", async ({ po }) => {
  // Create a temporary folder with a simple React-like structure
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dyad-custom-template-app-"),
  );

  // Create files for the template
  fs.writeFileSync(
    path.join(tempDir, "index.html"),
    `<!DOCTYPE html>
<html>
  <head><title>Custom Template App</title></head>
  <body>
    <div id="root">Custom Template from E2E Test</div>
  </body>
</html>`,
  );

  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      name: "custom-template-app",
      version: "1.0.0",
      scripts: {
        dev: "echo 'Custom template running'",
      },
    }),
  );

  try {
    await po.setUp();
    await po.goToHubTab();

    // Add custom template using the "Add Custom Template" button in header
    await po.page
      .getByRole("button", { name: "Add Custom Template" })
      .first()
      .click();

    await po.page.getByLabel("Template Name").fill("E2E App Template");
    await po.page
      .getByLabel("Description")
      .fill("Template for creating test apps");

    // Mock folder selection
    await po.electronApp.evaluate(
      async ({ dialog }, folderPath) => {
        const originalShowOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folderPath],
        });
        setTimeout(() => {
          dialog.showOpenDialog = originalShowOpenDialog;
        }, 100);
      },
      tempDir,
    );

    await po.page.getByRole("button", { name: "Browse" }).click();
    await po.page.waitForTimeout(200);

    await po.page.getByRole("button", { name: "Add Template" }).click();
    await po.page.waitForTimeout(1000);

    // Select the custom template
    await po.page.getByRole("img", { name: "E2E App Template" }).click();

    // Go back to apps and create an app
    await po.goToAppsTab();
    await po.sendPrompt("tc=create-app-from-custom-template");
    await po.approveProposal();

    // Verify the app was created with custom template
    await expect(po.page.getByTestId("file-tree")).toBeVisible();

    // Snapshot settings to confirm custom template selection
    await po.snapshotSettings();
  } finally {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("custom template - validation", async ({ po }) => {
  await po.goToHubTab();

  // Click add template button
  await po.page
    .getByRole("button", { name: "Add Custom Template" })
    .first()
    .click();

  // Try to submit without filling fields
  await po.page.getByRole("button", { name: "Add Template" }).click();

  // Error should be shown (we expect toast notification)
  await expect(po.page.getByText(/Please fill in all fields/)).toBeVisible({
    timeout: 2000,
  });

  // Fill only title
  await po.page.getByLabel("Template Name").fill("Test");
  await po.page.getByRole("button", { name: "Add Template" }).click();

  // Error should still be shown
  await expect(po.page.getByText(/Please fill in all fields/)).toBeVisible({
    timeout: 2000,
  });

  // Cancel the dialog
  await po.page.getByRole("button", { name: "Cancel" }).click();

  // Dialog should be closed
  await expect(
    po.page.getByRole("heading", { name: "Add Custom Template" }),
  ).not.toBeVisible();
});
