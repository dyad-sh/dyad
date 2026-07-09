import { expect, type Page } from "@playwright/test";
import { Timeout } from "./test_helper";

// Shared helpers for driving the Monaco-based code editor from e2e tests.
// Extracted so specs that exercise editor interactions (editing, saving,
// committing) don't each re-implement the same window.monaco plumbing.

export async function getActiveEditorModelPath(
  page: Page,
): Promise<string | null> {
  return page.evaluate(() => {
    // Monaco attaches itself to the window in the packaged app.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    if (!monaco) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor =
      monaco.editor.getEditors().find((candidate: any) => {
        return candidate.hasTextFocus?.() && candidate.getModel();
      }) ??
      monaco.editor.getEditors().find((candidate: any) => {
        return candidate.getModel();
      });
    return editor?.getModel()?.uri?.path ?? null;
  });
}

export async function getActiveEditorModelContent(
  page: Page,
): Promise<string | null> {
  return page.evaluate(() => {
    // Monaco attaches itself to the window in the packaged app.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    if (!monaco) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor =
      monaco.editor.getEditors().find((candidate: any) => {
        return candidate.hasTextFocus?.() && candidate.getModel();
      }) ??
      monaco.editor.getEditors().find((candidate: any) => {
        return candidate.getModel();
      });
    return editor?.getModel()?.getValue() ?? null;
  });
}

export async function selectFileAndWaitForEditor(page: Page, fileName: string) {
  await page.getByText(fileName, { exact: true }).click();
  await expect(async () => {
    const modelPath = await getActiveEditorModelPath(page);
    expect(modelPath).toContain(fileName);
  }).toPass({ timeout: Timeout.MEDIUM });
}

export async function replaceEditorContent(page: Page, content: string) {
  const editorContent = page.locator(".monaco-editor textarea").first();
  await expect(editorContent).toBeVisible();
  await editorContent.focus();
  // Small delay to let Monaco settle after click before selecting all
  await page.waitForTimeout(100);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(content);
  await expect
    .poll(() => getActiveEditorModelContent(page), { timeout: Timeout.MEDIUM })
    .toEqual(content);
}
