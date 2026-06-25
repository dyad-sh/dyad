import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const runVersionDiffViewTest = async (
  po: PageObject,
  disableNativeGit: boolean,
) => {
  await po.setUp({ autoApprove: true, disableNativeGit });

  // Create a second version so there's a commit with file changes to inspect.
  await po.sendPrompt("tc=write-index");
  await expect(po.page.getByRole("button", { name: "Version 2" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Open the version pane and select the latest version (the write-index commit).
  await po.page.getByRole("button", { name: "Version 2" }).click();
  await po.page.getByTestId("version-list-item").first().click();

  // Switch the preview panel to the code view; it should now focus on the
  // files changed in the selected version and render a diff editor.
  await po.previewPanel.selectPreviewMode("code");

  const diffView = po.page.getByTestId("version-diff-view");
  await expect(diffView).toBeVisible({ timeout: Timeout.LONG });

  // At least one changed file should be listed.
  const changedFiles = po.page.getByTestId("version-diff-file");
  await expect(changedFiles.first()).toBeVisible({ timeout: Timeout.MEDIUM });
  expect(await changedFiles.count()).toBeGreaterThan(0);

  // The Monaco diff editor should be shown for the selected file.
  await expect(po.page.getByTestId("version-diff-editor")).toBeVisible({
    timeout: Timeout.LONG,
  });
  await expect(po.page.locator(".monaco-diff-editor").first()).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Selecting a different changed file keeps the diff editor visible.
  const fileCount = await changedFiles.count();
  if (fileCount > 1) {
    await changedFiles.nth(1).click();
    await expect(po.page.getByTestId("version-diff-editor")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }
};

testSkipIfWindows("version diff view (native git)", async ({ po }) => {
  await runVersionDiffViewTest(po, false);
});

testSkipIfWindows("version diff view (isomorphic git)", async ({ po }) => {
  await runVersionDiffViewTest(po, true);
});
