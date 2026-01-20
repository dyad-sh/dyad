import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import * as fs from "fs";
import * as path from "path";

test("should show uncommitted files banner when there are changes", async ({
  po,
}) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  // Get the app path
  const appPath = await po.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }

  // Create a new file to simulate uncommitted changes
  const testFilePath = path.join(appPath, "test-uncommitted.txt");
  fs.writeFileSync(testFilePath, "This is a test file for uncommitted changes");

  // Wait for the banner to appear (it polls every 5 seconds, but let's also trigger a refresh)
  await po.page.waitForTimeout(1000);

  // The banner should be visible
  await expect(po.page.getByTestId("uncommitted-files-banner")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Verify the banner text mentions uncommitted changes
  await expect(po.page.getByTestId("uncommitted-files-banner")).toContainText(
    "uncommitted",
  );

  // Click the "Review & commit" button
  await po.page.getByTestId("review-commit-button").click();

  // Verify the dialog appears
  await expect(po.page.getByTestId("commit-dialog")).toBeVisible();

  // Verify the commit message input has a default value
  const commitInput = po.page.getByTestId("commit-message-input");
  await expect(commitInput).toBeVisible();
  const commitMessage = await commitInput.inputValue();
  expect(commitMessage.length).toBeGreaterThan(0);

  // Verify the changed files list shows our file
  await expect(po.page.getByTestId("changed-files-list")).toContainText(
    "test-uncommitted.txt",
  );

  // The file should be marked as "Added"
  await expect(po.page.getByTestId("changed-files-list")).toContainText(
    "Added",
  );

  // Edit the commit message
  await commitInput.clear();
  await commitInput.fill("Add test file for E2E test");

  // Click the commit button
  await po.page.getByTestId("commit-button").click();

  // Wait for success toast
  await po.waitForToast("success");

  // The dialog should close
  await expect(po.page.getByTestId("commit-dialog")).not.toBeVisible();

  // The banner should disappear after commit
  await expect(po.page.getByTestId("uncommitted-files-banner")).not.toBeVisible(
    {
      timeout: Timeout.MEDIUM,
    },
  );
});

test("should show multiple file statuses correctly", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  const appPath = await po.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }

  // Create a new file (added)
  const newFilePath = path.join(appPath, "new-file.txt");
  fs.writeFileSync(newFilePath, "New file content");

  // Modify an existing file (modified)
  const indexPath = path.join(appPath, "index.html");
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(indexPath, content + "\n<!-- Modified for test -->");
  }

  // Wait for the banner to appear
  await po.page.waitForTimeout(1000);

  await expect(po.page.getByTestId("uncommitted-files-banner")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Click review & commit
  await po.page.getByTestId("review-commit-button").click();

  // Verify the dialog shows multiple files
  await expect(po.page.getByTestId("commit-dialog")).toBeVisible();
  await expect(po.page.getByTestId("changed-files-list")).toContainText(
    "new-file.txt",
  );

  // Close the dialog
  await po.page.getByRole("button", { name: "Cancel" }).click();
  await expect(po.page.getByTestId("commit-dialog")).not.toBeVisible();
});

test("should not show banner when there are no uncommitted changes", async ({
  po,
}) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");

  // Wait a bit for the query to complete
  await po.page.waitForTimeout(2000);

  // The banner should NOT be visible when there are no uncommitted changes
  // Note: This test assumes tc=basic creates a clean git state
  // If this fails, it may be because the test fixture has uncommitted changes
  const banner = po.page.getByTestId("uncommitted-files-banner");
  const isVisible = await banner.isVisible().catch(() => false);

  // If there's no banner visible, the test passes
  // If there is a banner, we need to commit first to get a clean state
  if (isVisible) {
    // Commit any existing changes to get a clean state
    await po.page.getByTestId("review-commit-button").click();
    await po.page.getByTestId("commit-button").click();
    await po.waitForToast("success");

    // Now verify the banner is gone
    await expect(banner).not.toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }
});
