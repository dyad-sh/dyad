import {
  PageObject,
  test,
  testSkipIfWindows,
  Timeout,
} from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, execSync } from "child_process";

// Fold any runtime-generated workspace changes into the current commit so the
// worktree starts clean (otherwise the revert gate would trigger on those).
async function amendRuntimeWorkspaceIntoCurrentCommit(
  po: PageObject,
  appPath: string,
) {
  const status = execSync("git status --short -- pnpm-workspace.yaml", {
    cwd: appPath,
    encoding: "utf-8",
  }).trim();
  if (!status) {
    return;
  }
  await po.appManagement.configureGitUser();
  execFileSync("git", ["add", "--", "pnpm-workspace.yaml"], { cwd: appPath });
  execFileSync("git", ["commit", "--amend", "--no-edit", "--no-gpg-sign"], {
    cwd: appPath,
  });
}

function gitLog(appPath: string): string {
  return execSync("git log --oneline -n 30", {
    cwd: appPath,
    encoding: "utf-8",
  });
}

type GateAction = "commit" | "discard" | "cancel";

const runRevertGateTest = async (
  po: PageObject,
  { nativeGit, action }: { nativeGit: boolean; action: GateAction },
) => {
  await po.setUp({ autoApprove: true, disableNativeGit: !nativeGit });
  await po.sendPrompt("tc=write-index");

  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  await amendRuntimeWorkspaceIntoCurrentCommit(po, appPath);

  // Two versions exist: the initial app (v1) and the write-index change (v2).
  await expect
    .poll(async () =>
      po.page.getByRole("button", { name: "Version" }).textContent(),
    )
    .toBe("Version 2");

  // Make the worktree dirty with an untracked file.
  const dirtyFile = path.join(appPath, "gate-test.txt");
  fs.writeFileSync(dirtyFile, "uncommitted work");

  // Open the version pane, select the initial version (previews it and reveals
  // its restore button), then attempt to restore it.
  await po.page.getByRole("button", { name: "Version" }).click();
  await po.page.getByText("Init Dyad app Restore").click();
  await po.page
    .getByRole("button", { name: "Restore to this version" })
    .click();

  // Instead of erroring, the gate dialog should appear listing our change.
  const gate = po.page.getByTestId("uncommitted-changes-gate-dialog");
  await expect(gate).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(po.page.getByTestId("changed-files-list")).toContainText(
    "gate-test.txt",
  );

  if (action === "commit") {
    await po.page.getByTestId("commit-button").click();
  } else if (action === "discard") {
    await po.page.getByTestId("discard-button").click();
    await po.page.getByTestId("confirm-discard-button").click();
  } else {
    await gate.getByRole("button", { name: "Cancel" }).click();
  }

  await expect(gate).not.toBeVisible({ timeout: Timeout.MEDIUM });

  if (action === "cancel") {
    // Nothing was reverted; the user's change is left intact.
    expect(fs.existsSync(dirtyFile)).toBe(true);
    expect(gitLog(appPath)).not.toContain(
      "Reverted all changes back to version",
    );
    return;
  }

  // The revert proceeded after the worktree was made clean.
  await expect
    .poll(() => gitLog(appPath), { timeout: Timeout.MEDIUM })
    .toContain("Reverted all changes back to version");
  // Reverting to the initial version removes the file from the worktree.
  await expect
    .poll(() => fs.existsSync(dirtyFile), { timeout: Timeout.MEDIUM })
    .toBe(false);

  if (action === "commit") {
    // The user's work was committed onto main (reachable from HEAD) before the
    // revert, rather than orphaned on a detached preview HEAD.
    expect(gitLog(appPath)).toContain("Add 1 file");
  } else {
    // Discarded changes were never committed.
    expect(gitLog(appPath)).not.toContain("Add 1 file");
  }
};

testSkipIfWindows("revert gate - commit (native git)", async ({ po }) => {
  await runRevertGateTest(po, { nativeGit: true, action: "commit" });
});

test("revert gate - commit (isomorphic git)", async ({ po }) => {
  await runRevertGateTest(po, { nativeGit: false, action: "commit" });
});

test("revert gate - discard (isomorphic git)", async ({ po }) => {
  await runRevertGateTest(po, { nativeGit: false, action: "discard" });
});

test("revert gate - cancel (isomorphic git)", async ({ po }) => {
  await runRevertGateTest(po, { nativeGit: false, action: "cancel" });
});
