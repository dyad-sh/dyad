import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const VERSION_INTEGRITY_FILES = [
  ".gitignore",
  "a.txt",
  "AI_RULES.md",
  "b.txt",
  "dir/c.txt",
  "new-dir/d.txt",
  "new-file.js",
  "package.json",
  "to-be-deleted.txt",
  "to-be-edited.txt",
];

async function amendRuntimeWorkspaceIntoCurrentCommit(po: PageObject) {
  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }

  let status = "";
  for (let i = 0; i < 20; i++) {
    status = execSync("git status --short -- pnpm-workspace.yaml", {
      cwd: appPath,
      encoding: "utf-8",
    }).trim();
    if (status) break;
    await po.page.waitForTimeout(250);
  }
  if (!status) {
    return;
  }

  await po.appManagement.configureGitUser();
  execFileSync("git", ["add", "--", "pnpm-workspace.yaml"], {
    cwd: appPath,
  });
  execFileSync("git", ["commit", "--amend", "--no-edit", "--no-gpg-sign"], {
    cwd: appPath,
  });
}

const runVersionIntegrityTest = async (po: PageObject, nativeGit: boolean) => {
  await po.setUp({ autoApprove: true, disableNativeGit: !nativeGit });

  // Importing a simple app with a few files.
  await po.page.getByRole("button", { name: "Import App" }).click();
  await eph.stubDialog(po.electronApp, "showOpenDialog", {
    filePaths: [
      path.join(__dirname, "fixtures", "import-app", "version-integrity"),
    ],
  });

  await po.page.getByRole("button", { name: "Select Folder" }).click();
  await po.page.getByRole("textbox", { name: "Enter new app name" }).click();
  await po.page
    .getByRole("textbox", { name: "Enter new app name" })
    .fill("version-integrity-app");
  await po.page.getByRole("button", { name: "Import" }).click();

  // Initial snapshot
  await po.snapshotAppFiles({ name: "v1", files: VERSION_INTEGRITY_FILES });

  // Add a file and delete a file
  await po.sendPrompt("tc=version-integrity-add-edit-delete");
  await po.snapshotAppFiles({ name: "v2", files: VERSION_INTEGRITY_FILES });

  // Move a file
  await po.sendPrompt("tc=version-integrity-move-file");
  await po.snapshotAppFiles({ name: "v3", files: VERSION_INTEGRITY_FILES });
  await amendRuntimeWorkspaceIntoCurrentCommit(po);

  // Open version pane
  await po.page.getByRole("button", { name: "Version 3" }).click();
  await po.page.getByTestId("version-row-1").click();
  await po.snapshotAppFiles({ name: "v1", files: VERSION_INTEGRITY_FILES });

  const restoreButton = po.page.getByRole("button", {
    name: "Restore to this version",
  });
  await restoreButton.click();
  await expect(restoreButton).not.toBeVisible({ timeout: Timeout.LONG });
  // Should be same as the previous snapshot, but just to be sure.
  await po.snapshotAppFiles({ name: "v1", files: VERSION_INTEGRITY_FILES });
};

testSkipIfWindows("version integrity (git isomorphic)", async ({ po }) => {
  await runVersionIntegrityTest(po, false);
});

testSkipIfWindows("version integrity (git native)", async ({ po }) => {
  await runVersionIntegrityTest(po, true);
});
