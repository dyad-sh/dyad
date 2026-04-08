import { test, Timeout } from "./helpers/test_helper";
import { expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

async function getActiveEditorModelPath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Monaco attaches itself to the window in the packaged app.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    if (!monaco) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = monaco.editor.getEditors().find((candidate: any) => {
      return candidate.getModel();
    });
    const model = editor?.getModel();
    return model?.uri?.path ?? null;
  });
}

async function selectFileAndWaitForEditor(page: Page, fileName: string) {
  await page.getByText(fileName, { exact: true }).click();
  await expect(async () => {
    const modelPath = await getActiveEditorModelPath(page);
    expect(modelPath).toContain(fileName);
  }).toPass({ timeout: Timeout.MEDIUM });
}

async function replaceEditorContent(page: Page, content: string) {
  const editorContent = page.getByRole("textbox", {
    name: "Editor content",
  });
  await expect(editorContent).toBeVisible();
  await editorContent.click({ force: true });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(content);
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

  // Expect toast to be visible
  await expect(po.page.getByText("File saved")).toBeVisible();

  // We are NOT snapshotting the app files because the Monaco UI edit
  // is not deterministic.
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

  await expect
    .poll(
      () => fs.readFileSync(path.join(appPath, firstOpenedFilePath), "utf8"),
      { timeout: Timeout.MEDIUM },
    )
    .toEqual(firstFileEdit);
  await expect
    .poll(() => fs.readFileSync(path.join(appPath, robotsFilePath), "utf8"), {
      timeout: Timeout.MEDIUM,
    })
    .toEqual(updatedRobotsFile);
});
