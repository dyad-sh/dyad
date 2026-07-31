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
    const named = this.page.getByText(serverName, { exact: true });
    // Scoped to this server: a detail page for a different one still
    // needs the card clicked.
    const detailForServer = detail.filter({ has: named });
    const card = this.page.getByTestId("plugin-card").filter({ has: named });
    // Adding navigates here on its own, so wait for whichever of the two
    // settles first. Checking the detail page alone would read false
    // while a navigation is still in flight, then look for a card that
    // has already left the DOM.
    await expect(detailForServer.or(card).first()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    if (!(await detailForServer.isVisible())) {
      // A navigation landing between that check and this click removes
      // the card, which is a success rather than a failure. The
      // assertions below decide either way; log so a real click problem
      // isn't just an opaque timeout further down.
      await card.click().catch((error) => {
        console.log(`openPluginDetail: card click did not land: ${error}`);
      });
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
