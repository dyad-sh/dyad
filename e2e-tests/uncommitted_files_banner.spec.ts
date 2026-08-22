import { expect } from "@playwright/test";
import { PageObject, test, Timeout } from "./helpers/test_helper";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, execSync } from "child_process";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function configureGitForE2eCommit(appPath: string) {
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: appPath,
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: appPath,
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: appPath,
  });
}

function commitRuntimeBaselineChanges(appPath: string) {
  const status = execSync("git status --short -- pnpm-workspace.yaml", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  if (!status) {
    return;
  }

  configureGitForE2eCommit(appPath);
  execFileSync("git", ["add", "--", "pnpm-workspace.yaml"], {
    cwd: appPath,
  });
  execFileSync(
    "git",
    [
      "commit",
      "-m",
      "E2E baseline pnpm workspace",
      "--",
      "pnpm-workspace.yaml",
    ],
    { cwd: appPath },
  );
}

function installManualCommitPreCommitHook(appPath: string) {
  const hookPath = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"],
    { cwd: appPath, encoding: "utf-8" },
  ).trim();
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  const modePath = path.join(gitDir, "manual-commit-pre-commit-mode");
  const runLogPath = path.join(gitDir, "manual-commit-pre-commit-runs");

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(modePath, "pass\n");
  fs.writeFileSync(
    hookPath,
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      "const modePath = " + JSON.stringify(modePath) + ";",
      "const runLogPath = " + JSON.stringify(runLogPath) + ";",
      'const mode = fs.readFileSync(modePath, "utf8").trim();',
      'fs.appendFileSync(runLogPath, mode + "\\n");',
      // Keep the hook observable long enough to assert progress and cancellation.
      'const delayMs = mode === "slow" ? 10_000 : 500;',
      "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);",
      'if (mode === "fail") {',
      '  console.error("manual pre-commit hook intentionally failed");',
      "  process.exit(1);",
      "}",
      'console.log("manual pre-commit hook passed");',
      "",
    ].join("\n"),
  );
  if (process.platform !== "win32") {
    fs.chmodSync(hookPath, 0o755);
  }

  return { modePath, runLogPath };
}

const APP_START_TIMEOUT = process.env.CI ? 180_000 : Timeout.EXTRA_LONG;

const runDiscardChangesTest = async (po: PageObject) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.expectPreviewIframeIsVisible(APP_START_TIMEOUT);

  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  commitRuntimeBaselineChanges(appPath);

  const banner = po.page.getByTestId("uncommitted-files-banner");

  // Verify clean state
  await expect(banner).not.toBeVisible({ timeout: Timeout.MEDIUM });

  // Create a new file (untracked)
  const newFilePath = path.join(appPath, "discard-test.txt");
  fs.writeFileSync(newFilePath, "This file should be discarded");

  // Modify an existing file
  const indexPath = path.join(appPath, "index.html");
  let originalContent: string | null = null;
  if (fs.existsSync(indexPath)) {
    originalContent = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(
      indexPath,
      originalContent + "\n<!-- Should be discarded -->",
    );
  }

  // Wait for the banner to appear
  await expect(banner).toBeVisible({ timeout: Timeout.MEDIUM });

  // Click "Review & commit" to open the dialog
  await po.page.getByTestId("review-commit-button").click();
  await expect(po.page.getByTestId("commit-dialog")).toBeVisible();

  // Verify files are listed
  const changedFilesList = po.page.getByTestId("changed-files-list");
  await expect(changedFilesList).toContainText("discard-test.txt");

  // Click "Discard all" button
  await po.page.getByTestId("discard-button").click();

  // Verify confirmation warning appears
  await expect(po.page.getByTestId("confirm-discard-button")).toBeVisible();

  // Confirm the discard
  await po.page.getByTestId("confirm-discard-button").click();

  // Wait for success toast
  await po.toastNotifications.waitForToast("success", Timeout.MEDIUM);

  // Dialog should close
  await expect(po.page.getByTestId("commit-dialog")).not.toBeVisible();

  // Banner should disappear
  await expect(banner).not.toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify the new file was removed
  expect(fs.existsSync(newFilePath)).toBe(false);

  // Verify the modified file was restored
  if (originalContent !== null) {
    const restoredContent = fs.readFileSync(indexPath, "utf-8");
    expect(normalizeLineEndings(restoredContent)).toBe(
      normalizeLineEndings(originalContent),
    );
  }
};

const runUncommittedFilesBannerTest = async (po: PageObject) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.expectPreviewIframeIsVisible(APP_START_TIMEOUT);

  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  commitRuntimeBaselineChanges(appPath);

  // Ensure clean state - commit any existing changes first
  const banner = po.page.getByTestId("uncommitted-files-banner");

  // Verify banner is NOT visible when there are no uncommitted changes
  await expect(banner).not.toBeVisible({ timeout: Timeout.MEDIUM });

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

  // Clicking a file closes the dialog and reveals that file's diff in the code
  // panel, which the banner has to open since it lives in the chat header.
  await changedFilesList
    .getByTestId("commit-file-item")
    .filter({ hasText: "new-file.txt" })
    .click();
  await expect(po.page.getByTestId("commit-dialog")).not.toBeVisible();
  await expect(po.page.getByTestId("staged-diff-view")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Leaving the diff brings the dialog back with the typed message intact.
  await po.page.getByTestId("staged-diff-back-button").click();
  await expect(po.page.getByTestId("commit-dialog")).toBeVisible();
  await expect(commitInput).toHaveValue(testCommitMessage);

  // Click the commit button
  await po.page.getByTestId("commit-button").click();

  // Wait for success toast
  await po.toastNotifications.waitForToast("success", Timeout.MEDIUM);

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

test("uncommitted files banner", async ({ po }, testInfo) => {
  testInfo.setTimeout(APP_START_TIMEOUT + 120_000);
  await runUncommittedFilesBannerTest(po);
});

test("discard all uncommitted changes", async ({ po }, testInfo) => {
  testInfo.setTimeout(APP_START_TIMEOUT + 120_000);
  await runDiscardChangesTest(po);
});

test("manual commits run pre-commit hooks and surface failures", async ({
  po,
}, testInfo) => {
  testInfo.setTimeout(APP_START_TIMEOUT + 120_000);
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.expectPreviewIframeIsVisible(APP_START_TIMEOUT);

  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  commitRuntimeBaselineChanges(appPath);
  configureGitForE2eCommit(appPath);
  const { modePath, runLogPath } = installManualCommitPreCommitHook(appPath);

  const banner = po.page.getByTestId("uncommitted-files-banner");
  await expect(banner).not.toBeVisible({ timeout: Timeout.MEDIUM });

  const passingFile = path.join(appPath, "pre-commit-pass.txt");
  fs.writeFileSync(passingFile, "accepted by the hook\n");
  await expect(banner).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.getByTestId("review-commit-button").click();

  const dialog = po.page.getByTestId("commit-dialog");
  const messageInput = po.page.getByTestId("commit-message-input");
  const commitButton = po.page.getByTestId("commit-button");
  const passingMessage = "E2E manual commit accepted by pre-commit";
  await messageInput.clear();
  await messageInput.fill(passingMessage);
  await commitButton.click();
  await expect(commitButton).toContainText("Running pre-commit checks...", {
    timeout: Timeout.MEDIUM,
  });
  await po.toastNotifications.waitForToast("success", Timeout.MEDIUM);
  await expect(dialog).not.toBeVisible();
  expect(
    execFileSync("git", ["log", "-1", "--format=%s"], {
      cwd: appPath,
      encoding: "utf-8",
    }).trim(),
  ).toBe(passingMessage);
  expect(
    execFileSync("git", ["show", "HEAD:pre-commit-pass.txt"], {
      cwd: appPath,
      encoding: "utf-8",
    }),
  ).toBe("accepted by the hook\n");

  fs.writeFileSync(modePath, "fail\n");
  const failingFile = path.join(appPath, "pre-commit-fail.txt");
  fs.writeFileSync(failingFile, "rejected by the hook\n");
  await expect(banner).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.getByTestId("review-commit-button").click();

  const failingMessage = "E2E manual commit rejected by pre-commit";
  await messageInput.clear();
  await messageInput.fill(failingMessage);
  const headBeforeFailure = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  await commitButton.click();
  await expect(commitButton).toContainText("Running pre-commit checks...", {
    timeout: Timeout.MEDIUM,
  });

  const failureAlert = po.page.getByTestId("pre-commit-failure-alert");
  await expect(failureAlert).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(failureAlert).toContainText("Pre-commit checks failed");
  await failureAlert.getByText("View check output").click();
  await expect(failureAlert).toContainText(
    "manual pre-commit hook intentionally failed",
  );
  await expect(
    failureAlert.getByTestId("fix-pre-commit-with-ai-button"),
  ).toBeEnabled();
  await expect(messageInput).toHaveValue(failingMessage);

  expect(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appPath,
      encoding: "utf-8",
    }).trim(),
  ).toBe(headBeforeFailure);
  expect(
    execFileSync("git", ["status", "--short", "--", "pre-commit-fail.txt"], {
      cwd: appPath,
      encoding: "utf-8",
    }).trim(),
  ).toBe("A  pre-commit-fail.txt");
  expect(fs.readFileSync(runLogPath, "utf-8")).toBe("pass\nfail\n");

  fs.writeFileSync(modePath, "slow\n");
  const cancelledFile = path.join(appPath, "pre-commit-cancelled.txt");
  fs.writeFileSync(cancelledFile, "left staged after cancellation\n");
  const cancelledMessage = "E2E manual commit cancelled during pre-commit";
  await messageInput.clear();
  await messageInput.fill(cancelledMessage);
  await commitButton.click();

  const cancelCommitButton = po.page.getByTestId("cancel-commit-button");
  await expect(cancelCommitButton).toHaveText("Stop checks", {
    timeout: Timeout.MEDIUM,
  });
  await expect(cancelCommitButton).toBeEnabled();
  await cancelCommitButton.click();
  await expect(commitButton).toBeEnabled({ timeout: Timeout.MEDIUM });

  expect(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appPath,
      encoding: "utf-8",
    }).trim(),
  ).toBe(headBeforeFailure);
  expect(
    execFileSync(
      "git",
      ["status", "--short", "--", "pre-commit-cancelled.txt"],
      { cwd: appPath, encoding: "utf-8" },
    ).trim(),
  ).toBe("A  pre-commit-cancelled.txt");
  expect(fs.readFileSync(runLogPath, "utf-8")).toBe("pass\nfail\nslow\n");
});
