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

  // Click the named summary card and wait for its detail page.
  async openPluginDetail(serverName: string) {
    const card = this.page
      .getByTestId("plugin-card")
      .filter({ has: this.page.getByText(serverName, { exact: true }) });
    await expect(card).toBeVisible({ timeout: Timeout.MEDIUM });
    await card.click();
    await expect(this.page.getByTestId("plugin-detail")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }

  // Assert a tool on an already-open detail page, scoped so the
  // assertion can't pass on a tool that belongs to a different server.
  async waitForToolInDetail(toolName: string) {
    const detail = this.page.getByTestId("plugin-detail");
    await expect(detail.getByText(toolName, { exact: true })).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }

  // Navigate from the plugins list into the server's detail page and
  // assert the tool there.
  async waitForTool(serverName: string, toolName: string) {
    await this.openPluginDetail(serverName);
    await this.waitForToolInDetail(toolName);
  }
}
