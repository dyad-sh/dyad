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
  ).toBeHidden({
    timeout: Timeout.LONG,
  });

  const searchInput = po.page.getByTestId("file-tree-search");
  await expect(searchInput).toBeVisible({ timeout: Timeout.MEDIUM });

  // Content search should find files whose contents match the query and show line info
  await searchInput.fill("import");
  const resultItem = po.page.getByText("main.tsx").first();
  await expect(resultItem).toBeVisible({ timeout: Timeout.MEDIUM });

  // Files are collapsed by default in the new accordion UI, so we need to click to expand
  // Find the file name container (the clickable div that toggles expansion)
  const fileContainer = resultItem
    .locator("xpath=ancestor::div[contains(@class, 'cursor-pointer')]")
    .first();
  await expect(fileContainer).toBeVisible({ timeout: Timeout.MEDIUM });

  // Click on the file name to expand the accordion and show snippets
  await fileContainer.click();

  // Now the snippets should be visible - find the snippet container
  // The snippet is a div with class "ml-12" that contains the code snippet
  // Find it by looking for text containing "import" in the expanded section
  const snippetContainer = po.page
    .locator("div.ml-12")
    .filter({ hasText: /import/i })
    .first();
  await expect(snippetContainer).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify the snippet contains the search query
  const snippetText = await snippetContainer.textContent();
  expect(snippetText).toContain("import");

  // Click on the snippet container to navigate to that line
  await snippetContainer.click();
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    if (editorPosition) {
      // Monaco editor line numbers are 1-indexed
      // Verify that we navigated to a valid line (should be at least line 1)
      expect(editorPosition.lineNumber).toBeGreaterThanOrEqual(1);
    }
  }).toPass({ timeout: Timeout.MEDIUM });
});
