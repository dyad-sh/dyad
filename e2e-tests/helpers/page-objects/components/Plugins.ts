/**
 * Page object for the Plugins page (MCP server management).
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class Plugins {
  constructor(public page: Page) {}

  async openAddPluginDialog() {
    await this.page.getByRole("button", { name: "Add Plugin" }).click();
    await expect(
      this.page.getByRole("dialog", { name: "Add Plugin" }),
    ).toBeVisible();
  }

  // The dialog's submit button; the header button that opens the
  // dialog has the same accessible name, so scope to the dialog.
  async submitAddPluginDialog() {
    const dialog = this.page.getByRole("dialog", { name: "Add Plugin" });
    await dialog.getByRole("button", { name: "Add Plugin" }).click();
    await expect(dialog).not.toBeVisible({ timeout: Timeout.MEDIUM });
  }

  async waitForTool(serverName: string, toolName: string) {
    await expect(this.page.getByText(serverName, { exact: true })).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(this.page.getByText(toolName, { exact: true })).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }
}
