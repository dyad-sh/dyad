import { expect } from "@playwright/test";
import {
  PageObject,
  test,
  testSkipIfWindows,
  Timeout,
} from "./helpers/test_helper";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const runUncommittedFilesBannerTest = async (
  po: PageObject,
  nativeGit: boolean,
) => {
  await po.setUp({ disableNativeGit: !nativeGit });
  await po.sendPrompt("tc=basic");

  const appPath = await po.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }

  // Ensure clean state - commit any existing changes first
  const banner = po.page.getByTestId("uncommitted-files-banner");

  // Verify banner is NOT visible when there are no uncommitted changes
  await expect(banner).not.toBeVisible();

  // Create a new file (tests "added" status)
  const newFilePath = path.join(appPath, "new-file.txt");
  fs.writeFileSync(newFilePath, "New file content for E2E test");

  // Modify an existing file (tests "modified" status)
  const indexPath = path.join(appPath, "index.html");
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(indexPath, content + "\n<!-- Modified for E2E test -->");
  }

  // Wait for the banner to appear
  await expect(banner).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify the banner text mentions uncommitted changes
  await expect(banner).toContainText("uncommitted");

  // Click the "Review & commit" button
  await po.page.getByTestId("review-commit-button").click();

  // Verify the dialog appears
  await expect(po.page.getByTestId("commit-dialog")).toBeVisible();

  // Verify the commit message input has a default value
  const commitInput = po.page.getByTestId("commit-message-input");
  await expect(commitInput).toBeVisible();
  const defaultMessage = await commitInput.inputValue();
  expect(defaultMessage.length).toBeGreaterThan(0);

  // Verify the changed files list shows our files
  const changedFilesList = po.page.getByTestId("changed-files-list");
  await expect(changedFilesList).toContainText("new-file.txt");
  await expect(changedFilesList).toContainText("Added");

  // Check for modified file if index.html exists
  if (fs.existsSync(indexPath)) {
    await expect(changedFilesList).toContainText("index.html");
    await expect(changedFilesList).toContainText("Modified");
  }

  // Edit the commit message with a unique identifier we can verify in git
  const testCommitMessage = "E2E test commit - uncommitted files banner";
  await commitInput.clear();
  await commitInput.fill(testCommitMessage);

  // Click the commit button
  await po.page.getByTestId("commit-button").click();

  // Wait for success toast
  await po.waitForToast("success");

  // The dialog should close
  await expect(po.page.getByTestId("commit-dialog")).not.toBeVisible();

  // The banner should disappear after commit
  await expect(banner).not.toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify the git commit was actually made with the correct message
  const gitLog = execSync("git log -1 --format=%s", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  expect(gitLog).toBe(testCommitMessage);

  // Verify the files were committed
  const lastCommitFiles = execSync(
    "git diff-tree --no-commit-id --name-only -r HEAD",
    {
      cwd: appPath,
      encoding: "utf-8",
    },
  ).trim();
  expect(lastCommitFiles).toContain("new-file.txt");
};

test("uncommitted files banner", async ({ po }) => {
  await runUncommittedFilesBannerTest(po, false);
});

testSkipIfWindows(
  "uncommitted files banner with native git",
  async ({ po }) => {
    await runUncommittedFilesBannerTest(po, true);
  },
);
