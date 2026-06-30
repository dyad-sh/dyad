import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import { execFileSync, execSync } from "child_process";

async function amendRuntimeWorkspaceIntoCurrentCommit(po: PageObject) {
  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }

  const status = execSync("git status --short -- pnpm-workspace.yaml", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
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

const runSwitchVersionTest = async (
  po: PageObject,
  disableNativeGit: boolean,
) => {
  await po.setUp({ autoApprove: true, disableNativeGit });
  await po.sendPrompt("tc=write-index");

  await po.previewPanel.snapshotPreview({ name: `v2` });
  await amendRuntimeWorkspaceIntoCurrentCommit(po);

  expect(
    await po.page.getByRole("button", { name: "Version" }).textContent(),
  ).toBe("Version 2");
  await po.page.getByRole("button", { name: "Version" }).click();
  await po.page.getByTestId("version-row-1").click();
  await po.previewPanel.snapshotPreview({ name: `v1` });

  await po.page
    .getByRole("button", { name: "Restore to this version" })
    .click();
  // Should be same as the previous snapshot, but just to be sure.
  await po.previewPanel.snapshotPreview({ name: `v1` });

  await expect(po.page.getByText("Version 3")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
};

testSkipIfWindows("switch versions (native git)", async ({ po }) => {
  await runSwitchVersionTest(po, false);
});

testSkipIfWindows("switch versions (isomorphic git)", async ({ po }) => {
  await runSwitchVersionTest(po, true);
});
