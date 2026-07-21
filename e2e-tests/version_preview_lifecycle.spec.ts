import { expect } from "@playwright/test";
import { execFileSync, execSync } from "node:child_process";
import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function makeRuntimeTreeClean(po: PageObject, appPath: string) {
  const status = execSync("git status --short -- pnpm-workspace.yaml", {
    cwd: appPath,
    encoding: "utf8",
  }).trim();
  if (!status) return;
  await po.appManagement.configureGitUser();
  execFileSync("git", ["add", "--", "pnpm-workspace.yaml"], { cwd: appPath });
  execFileSync("git", ["commit", "--amend", "--no-edit", "--no-gpg-sign"], {
    cwd: appPath,
  });
}

testSkipIfWindows(
  "version preview is drained and isolated when switching apps",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");
    const appAName = await po.appManagement.getCurrentAppName();
    const appAPath = await po.appManagement.getCurrentAppPath();
    await po.sendPrompt("tc=write-index");
    await makeRuntimeTreeClean(po, appAPath);
    const originBranch = git(appAPath, "branch", "--show-current");
    const versionButton = po.page.getByRole("button", {
      name: /^Version \d+$/,
    });
    const currentVersionLabel = await versionButton.textContent();

    await versionButton.click();
    await po.page.getByTestId("version-row-1").click();
    await po.previewPanel.selectPreviewMode("code");
    await expect(po.page.getByTestId("version-diff-view")).toBeVisible({
      timeout: Timeout.LONG,
    });
    await po.page.getByTestId("version-diff-file").first().click();

    await po.appManagement.showAppList();
    await po.appManagement.importApp("version-integrity");
    await expect(po.page.getByTestId("version-diff-view")).not.toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await expect
      .poll(
        () => ({
          branch: git(appAPath, "branch", "--show-current"),
          status: git(appAPath, "status", "--short"),
        }),
        { timeout: Timeout.LONG },
      )
      .toEqual({ branch: originBranch, status: "" });

    await po.page.getByRole("button", { name: `${appAName} New Chat` }).click();
    await expect(po.page.getByTestId("version-diff-view")).not.toBeVisible();
    await expect(
      po.page.getByRole("button", { name: currentVersionLabel! }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.page.getByText("Version History")).not.toBeVisible();
  },
);
