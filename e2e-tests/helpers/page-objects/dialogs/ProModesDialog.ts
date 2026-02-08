/**
 * Page object for the Pro Modes dialog.
 * Handles smart context and turbo edits mode selection.
 */

import { Page } from "@playwright/test";

export class ProModesDialog {
  constructor(
    public page: Page,
    public close: () => Promise<void>,
  ) {}

  async setSmartContextMode(mode: "balanced" | "off" | "deep") {
    await this.page
      .getByTestId("smart-context-selector")
      .getByRole("button", {
        name: mode.charAt(0).toUpperCase() + mode.slice(1),
      })
      .click();
  }

  async setTurboEditsMode(mode: "off" | "classic" | "search-replace") {
    await this.page
      .getByTestId("turbo-edits-selector")
      .getByRole("button", {
        name:
          mode === "search-replace"
            ? "Search & replace"
            : mode.charAt(0).toUpperCase() + mode.slice(1),
      })
      .click();
  }
}
