/**
 * Page object for the preview panel.
 * Handles preview mode selection, iframe interactions, and error handling.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class PreviewPanel {
  constructor(public page: Page) {}

  async selectPreviewMode(
    mode:
      | "code"
      | "problems"
      | "preview"
      | "configure"
      | "security"
      | "publish",
  ) {
    await this.page.getByTestId(`${mode}-mode-button`).click();
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
    await this.page.getByText("Rebuild").click();
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

  async clickPreviewOpenBrowser() {
    await this.page.getByTestId("preview-open-browser-button").click();
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
    return this.page.getByText("Preparing app preview...");
  }

  locateStartingAppPreview() {
    return this.page.getByText("Starting your app server...");
  }

  getPreviewIframeElement() {
    return this.page.getByTestId("preview-iframe-element");
  }

  expectPreviewIframeIsVisible() {
    return expect(this.getPreviewIframeElement()).toBeVisible({
      timeout: Timeout.LONG,
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

  async snapshotPreviewErrorBanner() {
    await expect(this.locatePreviewErrorBanner()).toMatchAriaSnapshot({
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
