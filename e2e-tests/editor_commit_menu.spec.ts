import { test, Timeout } from "./helpers/test_helper";
import { expect, type Page } from "@playwright/test";
import path from "path";
import { execFileSync, execSync } from "child_process";
import {
  replaceEditorContent,
  selectFileAndWaitForEditor,
} from "./helpers/monaco_editor";

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

// The runtime scaffolds an app that leaves pnpm-workspace.yaml dirty. Commit it
// so the code editor starts from a clean working tree (no staged files).
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

async function editAndSaveFile(page: Page, fileName: string, content: string) {
  await selectFileAndWaitForEditor(page, fileName);
  await replaceEditorContent(page, content);
  await page.getByTestId("save-file-button").click();
  await expect(page.getByTestId("save-file-button")).toBeDisabled({
    timeout: Timeout.MEDIUM,
  });
}

// Editing two files in the code editor and clicking "Commit" should produce a
// SINGLE commit containing both files (previously each save was its own commit).
test("editor commit menu commits multiple staged files at once", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("foo");

  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  commitRuntimeBaselineChanges(appPath);
  configureGitForE2eCommit(appPath);

  const headBeforeEdits = execSync("git rev-parse HEAD", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();

  const madeWithDyadPath = path.join("src", "components", "made-with-dyad.tsx");
  const robotsPath = path.join("public", "robots.txt");

  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.selectPreviewMode("code");
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({ timeout: Timeout.LONG });

  // Edit and save two files. Saving stages (does not commit) each file.
  const madeWithDyadContent = 'export const MadeWithDyad = "commit-menu";\n';
  const robotsContent = "User-agent: *\nDisallow: /commit-menu\n";
  await editAndSaveFile(po.page, "made-with-dyad.tsx", madeWithDyadContent);
  await editAndSaveFile(po.page, "robots.txt", robotsContent);

  // The Commit button shows the number of staged files.
  const commitButton = po.page.getByTestId("editor-commit-button");
  await expect(commitButton).toContainText("2", { timeout: Timeout.MEDIUM });

  // The dropdown lists both staged files.
  await po.page.getByTestId("staged-files-trigger").click();
  const stagedItems = po.page.getByTestId("staged-file-item");
  await expect(stagedItems).toHaveCount(2);
  await expect(
    stagedItems.filter({ hasText: "made-with-dyad.tsx" }),
  ).toHaveCount(1);
  await expect(stagedItems.filter({ hasText: "robots.txt" })).toHaveCount(1);

  // Clicking a staged file opens its working-tree diff.
  await stagedItems.filter({ hasText: "robots.txt" }).click();
  await expect(po.page.getByTestId("staged-diff-view")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.page.getByTestId("staged-diff-back-button").click();
  await expect(po.page.getByTestId("staged-diff-view")).not.toBeVisible();

  // Open the commit dialog and verify both files are listed.
  await commitButton.click();
  const dialog = po.page.getByTestId("editor-commit-dialog");
  await expect(dialog).toBeVisible();

  const filesList = po.page.getByTestId("editor-commit-files-list");
  await expect(filesList).toContainText("made-with-dyad.tsx");
  await expect(filesList).toContainText("robots.txt");

  // The commit message is prefilled; replace it with a unique message.
  const messageInput = po.page.getByTestId("editor-commit-message-input");
  await expect(messageInput).toBeVisible();
  expect((await messageInput.inputValue()).length).toBeGreaterThan(0);
  const commitMessage = "E2E test - multi-file editor commit";
  await messageInput.clear();
  await messageInput.fill(commitMessage);

  await po.page.getByTestId("editor-commit-confirm-button").click();
  await po.toastNotifications.waitForToast("success");

  // Dialog closes and the staged-file count badge disappears.
  await expect(dialog).not.toBeVisible();
  await expect(commitButton).not.toContainText("2", {
    timeout: Timeout.MEDIUM,
  });

  // Exactly ONE new commit was created, with our message...
  const headAfterCommit = execSync("git rev-parse HEAD", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  expect(headAfterCommit).not.toBe(headBeforeEdits);
  const parentOfHead = execSync("git rev-parse HEAD~1", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  expect(parentOfHead).toBe(headBeforeEdits);

  const lastCommitMessage = execSync("git log -1 --format=%s", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  expect(lastCommitMessage).toBe(commitMessage);

  // ...and that single commit contains BOTH edited files.
  const committedFiles = execSync(
    "git diff-tree --no-commit-id --name-only -r HEAD",
    { cwd: appPath, encoding: "utf-8" },
  ).trim();
  expect(committedFiles).toContain(madeWithDyadPath.replace(/\\/g, "/"));
  expect(committedFiles).toContain(robotsPath.replace(/\\/g, "/"));

  // Working tree is clean again.
  const status = execSync("git status --short", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  expect(status).toBe("");
});
