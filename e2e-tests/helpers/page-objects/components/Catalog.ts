/**
 * Page object for the curated-catalog section of the Plugins page.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class Catalog {
  constructor(public page: Page) {}

  card(name: string) {
    return this.page
      .getByTestId("catalog-card")
      .filter({ has: this.page.getByText(name, { exact: true }) });
  }

  async addFromCatalog(name: string) {
    const card = this.card(name);
    await expect(card).toBeVisible({ timeout: Timeout.MEDIUM });
    await card.getByRole("button", { name: "Add" }).click();
  }

  async expectAdded(name: string) {
    await expect(this.card(name).getByText("Added")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  }

  async search(text: string) {
    await this.page.getByRole("textbox", { name: "Search catalog" }).fill(text);
  }
}
