/**
 * Page object for the Context Files Picker dialog.
 * Handles adding and removing context files in tests.
 */

import { Page } from "@playwright/test";

export class ContextFilesPickerDialog {
  constructor(
    public page: Page,
    public close: () => Promise<void>,
  ) {}

  async addManualContextFile(path: string) {
    await this.page.getByTestId("manual-context-files-input").fill(path);
    await this.page.getByTestId("manual-context-files-add-button").click();
  }

  async addAutoIncludeContextFile(path: string) {
    await this.page.getByTestId("auto-include-context-files-input").fill(path);
    await this.page
      .getByTestId("auto-include-context-files-add-button")
      .click();
  }

  async removeManualContextFile() {
    await this.page
      .getByTestId("manual-context-files-remove-button")
      .first()
      .click();
  }

  async removeAutoIncludeContextFile() {
    await this.page
      .getByTestId("auto-include-context-files-remove-button")
      .first()
      .click();
  }

  async addExcludeContextFile(path: string) {
    await this.page.getByTestId("exclude-context-files-input").fill(path);
    await this.page.getByTestId("exclude-context-files-add-button").click();
  }

  async removeExcludeContextFile() {
    await this.page
      .getByTestId("exclude-context-files-remove-button")
      .first()
      .click();
  }
}
