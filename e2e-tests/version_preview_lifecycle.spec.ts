import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";

const SCREENSHOT_FILENAME_REGEX = /^[0-9a-f]{40}\.png$/;

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function makeRuntimeTreeClean(po: PageObject, appPath: string) {
  const screenshotDir = path.join(appPath, ".dyad", "screenshot");
  await expect(async () => {
    const entries = fs.existsSync(screenshotDir)
      ? fs.readdirSync(screenshotDir)
      : [];
    expect(entries.some((entry) => SCREENSHOT_FILENAME_REGEX.test(entry))).toBe(
      true,
    );
  }).toPass({ timeout: Timeout.MEDIUM });

  const status = git(appPath, "status", "--short");
  if (!status) return;
  await po.appManagement.configureGitUser();
  execFileSync("git", ["add", "--all"], { cwd: appPath });
  execFileSync("git", ["commit", "--amend", "--no-edit", "--no-gpg-sign"], {
    cwd: appPath,
  });
}

testSkipIfWindows(
  "version preview is drained and isolated when switching apps",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();
    const appAName = await po.appManagement.getCurrentAppName();
    const appAPath = await po.appManagement.getCurrentAppPath();
    await po.sendPrompt("tc=write-index");
    await expect(
      po.previewPanel.getPreviewIframeElement().contentFrame().locator("body"),
    ).toBeVisible({ timeout: Timeout.LONG });
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

    await po.page
      .getByRole("button", { name: `${appAName} New Chat` })
      .first()
      .click();
    await expect(po.page.getByTestId("version-diff-view")).not.toBeVisible();
    await expect(
      po.page.getByRole("button", { name: currentVersionLabel! }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.page.getByText("Version History")).not.toBeVisible();
  },
);
