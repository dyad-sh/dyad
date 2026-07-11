import { expect, type Page } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

async function getActiveEditorModelPath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Monaco is attached to the window by the packaged application.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    if (!monaco) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = monaco.editor
      .getEditors()
      .find((candidate: any) => candidate.getModel());
    return editor?.getModel()?.uri?.path ?? null;
  });
}

async function quickOpenFile(page: Page, path: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByTestId("code-quick-open-dialog");
  await expect(dialog).toBeVisible();
  const input = page.getByTestId("code-quick-open-input");
  await input.fill(path);
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => getActiveEditorModelPath(page), { timeout: Timeout.MEDIUM })
    .toContain(path);
}

test("code workspace supports focused layout, quick open, and tabs", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.navigation.goToChatTab();
  await po.previewPanel.selectPreviewMode("code");
  await expect(po.page.getByTestId("code-workspace")).toBeVisible({
    timeout: Timeout.LONG,
  });

  const chatPanel = po.page.locator("#chat-panel");
  const previewPanel = po.page.locator("#preview-panel");
  await expect
    .poll(async () => {
      const chatBox = await chatPanel.boundingBox();
      const previewBox = await previewPanel.boundingBox();
      if (!chatBox || !previewBox) return 0;
      return previewBox.width / chatBox.width;
    })
    .toBeGreaterThan(1.5);

  await po.page.getByTestId("code-workspace").click();
  await quickOpenFile(po.page, "src/main.tsx");
  await quickOpenFile(po.page, "src/App.tsx");

  const tabs = po.page.getByTestId("code-editor-tabs");
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(
    po.page.getByTestId("code-editor-tab-src/App.tsx").getByRole("tab"),
  ).toHaveAttribute("aria-selected", "true");

  const editor = po.page.locator(".monaco-editor textarea").first();
  await editor.focus();
  await po.page.keyboard.press("Control+Tab");
  await expect
    .poll(() => getActiveEditorModelPath(po.page), {
      timeout: Timeout.MEDIUM,
    })
    .toContain("src/main.tsx");

  await po.page.getByRole("button", { name: "Close main.tsx" }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(1);

  await po.page.getByTestId("code-toggle-explorer-button").click();
  await expect(po.page.getByTestId("file-tree-search")).toBeHidden();
  await po.page.getByTestId("code-toggle-explorer-button").click();
  await expect(po.page.getByTestId("file-tree-search")).toBeVisible();

  await po.page.getByTestId("code-toggle-chat-button").click();
  await expect
    .poll(async () => (await chatPanel.boundingBox())?.width ?? 100)
    .toBeLessThan(20);
  await po.page.getByTestId("code-toggle-chat-button").click();
  await expect
    .poll(async () => {
      const chatBox = await chatPanel.boundingBox();
      const previewBox = await previewPanel.boundingBox();
      if (!chatBox || !previewBox) return 0;
      return previewBox.width / chatBox.width;
    })
    .toBeGreaterThan(1.5);
  await po.page.screenshot({ path: "/tmp/dyad-code-workspace-foundation.png" });
});
