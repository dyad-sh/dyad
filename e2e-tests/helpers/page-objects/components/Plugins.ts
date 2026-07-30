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

  // Ensure the named server's detail page is open, clicking its summary
  // card only if it isn't already. Adding a server lands on this page
  // by itself, so callers can ask for it either way.
  async openPluginDetail(serverName: string) {
    const detail = this.page.getByTestId("plugin-detail");
    const card = this.page
      .getByTestId("plugin-card")
      .filter({ has: this.page.getByText(serverName, { exact: true }) });
    // Adding navigates here on its own, so wait for whichever of the two
    // settles first. Checking the detail page alone would read false
    // while a navigation is still in flight, then look for a card that
    // has already left the DOM.
    await expect(detail.or(card).first()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    if (!(await detail.isVisible())) {
      await card.click();
    }
    await expect(detail).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(detail.getByText(serverName, { exact: true })).toBeVisible({
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
