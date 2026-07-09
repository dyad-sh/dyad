import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  replaceEditorContent,
  selectFileAndWaitForEditor,
} from "./helpers/monaco_editor";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
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
    .toEqual(expectedContent);
}

test("edit code", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  const editedFilePath = path.join("src", "components", "made-with-dyad.tsx");
  await po.sendPrompt("foo");
  const appPath = await po.appManagement.getCurrentAppPath();

  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("code");
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({
    timeout: Timeout.LONG,
  });

  await selectFileAndWaitForEditor(po.page, "made-with-dyad.tsx");
  await replaceEditorContent(po.page, "export const MadeWithDyad = ;");

  // Save the file
  await po.page.getByTestId("save-file-button").click();

  // We are NOT snapshotting the app files because the Monaco UI edit
  // is not deterministic.
  await expectFileContent(
    appPath,
    editedFilePath,
    "export const MadeWithDyad = ;",
  );
  const editedFile = fs.readFileSync(
    path.join(appPath, editedFilePath),
    "utf8",
  );
  expect(editedFile).toContain("export const MadeWithDyad = ;");
});

test("edit code edits the right file during rapid switches", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  const firstOpenedFilePath = path.join(
    "src",
    "components",
    "made-with-dyad.tsx",
  );
  const robotsFilePath = path.join("public", "robots.txt");
  await po.sendPrompt("foo");
  const appPath = await po.appManagement.getCurrentAppPath();
  let firstFileEdit = "";
  let updatedRobotsFile = "";

  await po.previewPanel.clickTogglePreviewPanel();

  await po.previewPanel.selectPreviewMode("code");
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({
    timeout: Timeout.LONG,
  });

  await selectFileAndWaitForEditor(po.page, "made-with-dyad.tsx");
  for (const round of [1, 2, 3]) {
    firstFileEdit = `export const MadeWithDyad = "round-${round}";\n`;
    updatedRobotsFile = `User-agent: *\nDisallow: /round-${round}\n`;

    await replaceEditorContent(po.page, firstFileEdit);
    await selectFileAndWaitForEditor(po.page, "robots.txt");
    await replaceEditorContent(po.page, updatedRobotsFile);
    await selectFileAndWaitForEditor(po.page, "made-with-dyad.tsx");
  }

  await expectFileContent(appPath, firstOpenedFilePath, firstFileEdit);
  await expectFileContent(appPath, robotsFilePath, updatedRobotsFile);
});
