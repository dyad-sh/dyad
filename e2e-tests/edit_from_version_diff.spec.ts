import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

function readGitHead(appPath: string) {
  return fs.readFileSync(path.join(appPath, ".git", "HEAD"), "utf8").trim();
}

testSkipIfWindows(
  "only offers version diff editing for the branch tip version",
  async ({ po }: { po: PageObject }) => {
    await po.setUp({ autoApprove: true });

    // Create two more versions so there is a non-latest version to check out
    // whose diff contains a known file (src/pages/Index.tsx).
    await po.sendPrompt("tc=write-index");
    await po.sendPrompt("tc=write-index-2");
    await expect(
      po.page.getByRole("button", { name: "Version 3" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    const appPath = await po.appManagement.getCurrentAppPath();
    if (!appPath) {
      throw new Error("No app path found");
    }
    // Open the version pane and check out version 2 (the middle version).
    await po.page.getByRole("button", { name: "Version 3" }).click();
    await po.page.getByTestId("version-row-2").click();

    // Precondition: the checkout actually detached HEAD. If this ever stopped
    // detaching, the test would no longer exercise the re-attach path.
    await expect
      .poll(() => readGitHead(appPath), { timeout: Timeout.MEDIUM })
      .not.toBe("ref: refs/heads/main");

    // Show the checked-out version's diff and open the Index.tsx change.
    await po.previewPanel.selectPreviewMode("code");
    await expect(po.page.getByTestId("version-diff-view")).toBeVisible({
      timeout: Timeout.LONG,
    });
    await po.page
      .getByTestId("version-diff-file")
      .filter({ hasText: "Index.tsx" })
      .click();
    await expect(po.page.getByTestId("version-diff-editor")).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Historical versions are view-only, even though HEAD is detached there.
    await expect(po.page.getByTestId("diff-edit-toggle")).toBeHidden();

    // The branch tip version is the only version-diff snapshot that can be
    // edited. Selecting it still checks out the commit SHA, but the writable tip
    // was resolved from the stable branch ref before checkout.
    await po.page.getByTestId("version-row-3").click();
    await expect(po.page.getByTestId("version-diff-view")).toBeVisible({
      timeout: Timeout.LONG,
    });
    await expect(po.page.getByTestId("diff-edit-toggle")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  },
);
