import { test, Timeout } from "./helpers/test_helper";
import { expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  replaceEditorContent,
  selectFileAndWaitForEditor,
} from "./helpers/monaco_editor";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

async function expectFileContent(
  appPath: string,
  relativePath: string,
  expectedContent: string,
) {
  await expect
    .poll(
      () =>
        normalizeLineEndings(
          fs.readFileSync(path.join(appPath, relativePath), "utf8"),
        ),
      { timeout: Timeout.MEDIUM },
    )
    .toEqual(normalizeLineEndings(expectedContent));
}

// Sets the modified (right/new) pane of the visible Monaco diff editor. Uses the
// editor API rather than typing so the edit is deterministic; this still drives
// the real dirty/save wiring (onDidChangeModelContent -> Save button).
async function setDiffModifiedContent(page: Page, value: string) {
  await page.evaluate((newValue) => {
    // Monaco attaches itself to the window in the packaged app.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    const diffEditor = monaco?.editor?.getDiffEditors?.()[0];
    diffEditor?.getModifiedEditor().setValue(newValue);
  }, value);
}

// Reviewers sometimes want to tweak a diff by hand. The pencil in the diff
// toolbar makes the modified pane editable and the Save button writes it back to
// the working file.
test("edit a file from the staged diff view", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("foo");
  const appPath = await po.appManagement.getCurrentAppPath();
  if (!appPath) {
    throw new Error("No app path found");
  }
  const editedFilePath = path.join("src", "components", "made-with-dyad.tsx");

  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.selectPreviewMode("code");
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({ timeout: Timeout.LONG });

  // Edit + save a file so there is a staged change to open a diff for.
  await selectFileAndWaitForEditor(po.page, "made-with-dyad.tsx");
  await replaceEditorContent(
    po.page,
    'export const MadeWithDyad = "staged";\n',
  );
  await po.page.getByTestId("save-file-button").click();
  await expect(po.page.getByTestId("save-file-button")).toBeDisabled({
    timeout: Timeout.MEDIUM,
  });

  // Open the working-tree diff for that staged file.
  await po.page.getByTestId("staged-files-trigger").click();
  await po.page
    .getByTestId("staged-file-item")
    .filter({ hasText: "made-with-dyad.tsx" })
    .click();
  await expect(po.page.getByTestId("staged-diff-view")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // The Save button only appears once edit mode is enabled.
  await expect(po.page.getByTestId("diff-save-button")).toBeHidden();

  // Enable edit mode via the toolbar pencil, then edit the modified pane.
  await po.page.getByTestId("diff-edit-toggle").click();
  const editedContent = 'export const MadeWithDyad = "edited-from-diff";\n';
  await setDiffModifiedContent(po.page, editedContent);

  const saveButton = po.page.getByTestId("diff-save-button");
  await expect(saveButton).toBeEnabled({ timeout: Timeout.MEDIUM });
  await saveButton.click();
  await expect(saveButton).toBeDisabled({ timeout: Timeout.MEDIUM });

  // The edit is persisted to the working file.
  await expectFileContent(appPath, editedFilePath, editedContent);
});
