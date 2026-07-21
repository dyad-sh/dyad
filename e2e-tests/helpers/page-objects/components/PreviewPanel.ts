/**
 * Page object for the preview panel.
 * Handles preview mode selection, iframe interactions, and error handling.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class PreviewPanel {
  constructor(public page: Page) {}

  getPlanContent() {
    return this.page.getByTestId("plan-content");
  }

  getPlanSelectionCommentButton() {
    return this.page.getByRole("button", { name: "Add comment" });
  }

  getPlanCommentsButton() {
    return this.page.getByRole("button", { name: "View comments" });
  }

  getPlanAnnotationMarks() {
    return this.page.locator("mark[data-annotation-id]");
  }

  async selectTextInPlan(selectedText: string) {
    const planContent = this.getPlanContent();
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });

    await planContent.evaluate((container, text) => {
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) =>
            (node.textContent ?? "").trim().length > 0
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
        },
      );

      let currentNode: Text | null;
      while ((currentNode = walker.nextNode() as Text | null)) {
        const startOffset = currentNode.textContent?.indexOf(text) ?? -1;
        if (startOffset === -1) {
          continue;
        }

        const range = document.createRange();
        range.setStart(currentNode, startOffset);
        range.setEnd(currentNode, startOffset + text.length);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        (currentNode.parentElement ?? container).dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true }),
        );
        return;
      }

      throw new Error(`Could not find "${text}" in plan content`);
    }, selectedText);
  }

  async selectPreviewMode(
    mode:
      | "code"
      | "problems"
      | "preview"
      | "configure"
      | "security"
      | "publish"
      | "tests",
  ) {
    // Mode buttons live inside the preview panel, so the panel must be expanded
    // before they're clickable. If the panel is collapsed, the chat panel covers
    // the toolbar and intercepts pointer events.
    const previewPanel = this.page.locator("#preview-panel");
    const sizeAttr = await previewPanel.getAttribute("data-panel-size");
    if (sizeAttr === null || parseFloat(sizeAttr) < 5) {
      await this.page.getByTestId("toggle-preview-panel-button").click();
      // Wait for panel-resize transition (chat.tsx uses 100ms transition)
      await this.page.waitForFunction(
        () => {
          const el = document.querySelector("#preview-panel");
          const v = el?.getAttribute("data-panel-size");
          return v !== null && v !== undefined && parseFloat(v) >= 5;
        },
        undefined,
        { timeout: Timeout.MEDIUM },
      );
    }

    // When the tab row is too narrow, trailing tabs move into an overflow
    // dropdown ("…"). Open the dropdown first if the direct button isn't
    // visible; the active tab is always rendered in the row itself.
    const directButton = this.page.getByTestId(`${mode}-mode-button`);
    await expect(async () => {
      const isInOverflow =
        (await directButton
          .first()
          .isVisible()
          .catch(() => false)) === false;
      if (isInOverflow) {
        await this.page
          .getByTestId("preview-mode-overflow-button")
          .click({ timeout: 1_000 });
      }
      await expect(directButton.first()).toBeVisible({ timeout: 1_000 });
      await directButton.first().click({ timeout: 1_000 });
    }).toPass({ timeout: Timeout.MEDIUM });
  }

  // --- Tests panel (behind the per-app opt-in gate) ---

  locateEnableTestingButton() {
    return this.page.getByRole("button", {
      name: "Enable testing for this app",
    });
  }

  locateDisableTestingButton() {
    return this.page.getByRole("button", {
      name: "Disable testing for this app",
    });
  }

  locateRunAllTestsButton() {
    return this.page.getByRole("button", { name: "Run all tests" });
  }

  async clickEnableTesting() {
    await this.locateEnableTestingButton().click();
  }

  async clickDisableTesting() {
    await this.locateDisableTestingButton().click();
  }

  async clickRecheckProblems() {
    await this.page.getByTestId("recheck-button").click();
  }

  async clickFixAllProblems() {
    await this.page.getByTestId("fix-all-button").click();
  }

  async snapshotProblemsPane() {
    await expect(this.page.getByTestId("problems-pane")).toMatchAriaSnapshot({
      timeout: Timeout.MEDIUM,
    });
  }

  async clickRebuild() {
    await this.clickPreviewMoreOptions();
    // The preview can rerender this animated menu while Playwright waits for
    // the item to become stable, closing it before the click is dispatched.
    await this.page.getByText("Rebuild").click({ force: true });
  }

  async clickTogglePreviewPanel() {
    await this.page.getByTestId("toggle-preview-panel-button").click();
  }

  async clickPreviewPickElement() {
    await this.page
      .getByTestId("preview-pick-element-button")
      .click({ timeout: Timeout.EXTRA_LONG });
  }

  async clickDeselectComponent(options?: { index?: number }) {
    const buttons = this.page.getByRole("button", {
      name: "Deselect component",
    });
    if (options?.index !== undefined) {
      await buttons.nth(options.index).click();
    } else {
      await buttons.first().click();
    }
  }

  async clickPreviewMoreOptions() {
    await this.page.getByTestId("preview-more-options-button").click();
  }

  async clickPreviewRefresh() {
    await this.page.getByTestId("preview-refresh-button").click();
  }

  async clickPreviewNavigateBack() {
    await this.page.getByTestId("preview-navigate-back-button").click();
  }

  async clickPreviewNavigateForward() {
    await this.page.getByTestId("preview-navigate-forward-button").click();
  }

  getPreviewAddressBarInput() {
    return this.page.getByTestId("preview-address-bar-input");
  }

  async fillPreviewAddressBar(path: string) {
    const input = this.getPreviewAddressBarInput();
    await input.fill(path);
    await input.press("Enter");
  }

  async clickPreviewOpenBrowser() {
    await this.page.getByTestId("preview-open-browser-button").click();
  }

  async clickCopyShareableLink() {
    await this.page.getByTestId("preview-copy-shareable-link-button").click();
  }

  getCloudBadge() {
    return this.page.getByTestId("preview-cloud-badge");
  }

  async clickPreviewAnnotatorButton() {
    await this.page
      .getByTestId("preview-annotator-button")
      .click({ timeout: Timeout.EXTRA_LONG });
  }

  async waitForAnnotatorMode() {
    // Wait for the annotator toolbar to be visible
    await expect(this.page.getByRole("button", { name: "Select" })).toBeVisible(
      {
        timeout: Timeout.MEDIUM,
      },
    );
  }

  async clickAnnotatorSubmit() {
    await this.page.getByRole("button", { name: "Add to Chat" }).click();
  }

  locateLoadingAppPreview() {
    return this.locatePreviewLoadingScreen();
  }

  locatePreviewLoadingScreen() {
    return this.page.getByTestId("preview-loading-screen");
  }

  locatePreviewLoadingLogList() {
    return this.page.getByTestId("preview-loading-log-list");
  }

  locatePreviewLoadingErrorBanner() {
    return this.page.getByTestId("preview-loading-error-banner");
  }

  async clickPreviewLoadingErrorToggle() {
    await this.page.getByTestId("preview-loading-error-toggle").click();
  }

  async clickPreviewLoadingFixErrors() {
    await this.page.getByTestId("preview-loading-fix-errors-button").click();
  }

  locatePreviewLoadingRebuildButton() {
    return this.page.getByTestId("preview-loading-rebuild-button");
  }

  async clickPreviewLoadingRebuild() {
    await this.locatePreviewLoadingRebuildButton().click();
  }

  getPreviewIframeElement() {
    return this.page.getByTestId("preview-iframe-element");
  }

  expectPreviewIframeIsVisible(timeout = Timeout.LONG) {
    return expect(this.getPreviewIframeElement()).toBeVisible({
      timeout,
    });
  }

  async clickFixErrorWithAI() {
    await this.page.getByRole("button", { name: "Fix error with AI" }).click();
  }

  async clickCopyErrorMessage() {
    await this.page
      .getByTestId("preview-error-banner")
      .getByRole("button", { name: /Copy/ })
      .click();
  }

  async clickFixAllErrors() {
    await this.page.getByRole("button", { name: /Fix All Errors/ }).click();
  }

  async snapshotPreviewErrorBanner({ name }: { name?: string } = {}) {
    await expect(this.locatePreviewErrorBanner()).toMatchAriaSnapshot({
      name,
      timeout: Timeout.LONG,
    });
  }

  locatePreviewErrorBanner() {
    return this.page.getByTestId("preview-error-banner");
  }

  getSelectedComponentsDisplay() {
    return this.page.getByTestId("selected-component-display");
  }

  async snapshotSelectedComponentsDisplay() {
    await expect(this.getSelectedComponentsDisplay()).toMatchAriaSnapshot();
  }

  async snapshotPreview({ name }: { name?: string } = {}) {
    const iframe = this.getPreviewIframeElement();
    await expect(iframe.contentFrame().locator("body")).toMatchAriaSnapshot({
      name,
      timeout: Timeout.LONG,
    });
  }
}
