/**
 * Page object for the inline code editor.
 * Handles editing, saving, and canceling file edits.
 */

import { Page } from "@playwright/test";

export class CodeEditor {
  constructor(public page: Page) {}

  async clickEditButton() {
    await this.page.locator('button:has-text("Edit")').first().click();
  }

  async editFileContent(content: string) {
    const editor = this.page.locator(".monaco-editor textarea").first();
    await editor.focus();
    await editor.press("Home");
    await editor.type(content);
  }

  async saveFile() {
    await this.page.locator('[data-testid="save-file-button"]').click();
  }

  async cancelEdit() {
    await this.page.locator('button:has-text("Cancel")').first().click();
  }
}
