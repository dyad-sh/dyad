/**
 * Page object for agent tool consent banner.
 * Handles consent interactions for agent tools.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class AgentConsent {
  constructor(public page: Page) {}

  getAgentConsentBanner() {
    return this.page
      .getByRole("button", { name: "Always allow" })
      .locator("..");
  }

  async waitForAgentConsentBanner(timeout = Timeout.MEDIUM) {
    await expect(
      this.page.getByRole("button", { name: "Always allow" }),
    ).toBeVisible({ timeout });
  }

  async clickAgentConsentAlwaysAllow() {
    await this.page.getByRole("button", { name: "Always allow" }).click();
  }

  async clickAgentConsentAllowOnce() {
    await this.page.getByRole("button", { name: "Allow once" }).click();
  }

  async clickAgentConsentDecline() {
    await this.page.getByRole("button", { name: "Decline" }).click();
  }
}
