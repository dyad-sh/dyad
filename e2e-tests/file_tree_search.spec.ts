import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("file tree search finds content matches and surfaces line numbers", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.goToChatTab();
  await po.selectPreviewMode("code");
  // Wait for the code view to finish loading files
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({ timeout: Timeout.LONG });

  const searchInput = po.page.getByTestId("file-tree-search");
  await expect(searchInput).toBeVisible({ timeout: Timeout.MEDIUM });

  // Content search should find files whose contents match the query and show line info
  await searchInput.fill("brings joy");
  const resultItem = po.page.getByText("jumia.tsx").first();
  await expect(resultItem).toBeVisible({ timeout: Timeout.MEDIUM });

  // Find the line number snippet specifically within the jumia.tsx result
  // The snippet is in the same list item as the file name
  // We find the parent list item and then find the line number text within it
  const fileTreeListItem = resultItem.locator("xpath=ancestor::li[1]");
  const lineNumberSnippet = fileTreeListItem.getByText(/^line \d+$/i).first();
  await expect(lineNumberSnippet).toBeVisible({ timeout: Timeout.MEDIUM });

  // Extract the line number from the snippet text
  const lineNumberText = await lineNumberSnippet.textContent();
  const lineNumberMatch = lineNumberText?.match(/line (\d+)/i);
  const expectedLineNumber = lineNumberMatch
    ? parseInt(lineNumberMatch[1], 10)
    : null;

  expect(expectedLineNumber).not.toBeNull();

  // Click on the line number snippet to navigate to that line
  // The snippet container is clickable, so clicking the text will trigger navigation
  await lineNumberSnippet.click();

  // Breadcrumb/path should reflect the opened file
  await expect(po.page.getByText("jumia.tsx")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Wait for Monaco editor to be available before checking position
  await expect(async () => {
    const editorPosition = await po.page.evaluate(() => {
      // Find the Monaco editor instance
      const editorElement = document.querySelector(".monaco-editor");
      if (!editorElement) return null;

      // Access Monaco editor via the window object (Monaco editor attaches itself)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const monaco = (window as any).monaco;
      if (!monaco) return null;

      // Get all editor instances
      const editors = monaco.editor.getEditors();
      if (editors.length === 0) return null;

      // Find the editor instance that corresponds to the file editor
      // The file editor should be the one with a model loaded
      const editor =
        editors.find((e: any) => {
          const model = e.getModel();
          return model && model.getLineCount() > 0;
        }) || editors[0];

      const position = editor.getPosition();
      return position
        ? { lineNumber: position.lineNumber, column: position.column }
        : null;
    });

    expect(editorPosition).not.toBeNull();
    if (editorPosition && expectedLineNumber) {
      // Monaco editor line numbers are 1-indexed, and we expect to be on or very close to the target line
      expect(editorPosition.lineNumber).toBeGreaterThanOrEqual(
        expectedLineNumber - 1,
      );
      expect(editorPosition.lineNumber).toBeLessThanOrEqual(
        expectedLineNumber + 1,
      );
    }
  }).toPass({ timeout: Timeout.MEDIUM });
});
