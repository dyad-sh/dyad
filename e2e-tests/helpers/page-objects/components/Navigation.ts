/**
 * Page object for navigation between tabs and pages.
 * Handles tab navigation and back button.
 */

import { Page, expect } from "@playwright/test";

export class Navigation {
  constructor(public page: Page) {}

  async goToSettingsTab() {
    await this.page.getByRole("link", { name: "Settings" }).click();
  }

  async goToLibraryTab() {
    await this.page.getByRole("link", { name: "Library" }).click();
  }

  async goToAppsTab() {
    const appsLink = this.page.getByRole("link", { name: "Apps" });
    await expect(appsLink).toBeVisible({ timeout: 60000 });
    await appsLink.click();
    await expect(this.page.getByText("Build a new app")).toBeVisible();
  }

  async goToChatTab() {
    // Chat is now nested under Apps - clicking Apps navigates to "/"
    // and shows the chat list if an app is already selected.
    // The sidebar no longer clears app selection when clicking Apps,
    // so this preserves the selected app and shows the chat UI.
    await this.page.getByRole("link", { name: "Apps" }).click();
    // Wait for the chat UI to be visible (chat mode selector indicates chat-ready state)
    await expect(this.page.getByTestId("chat-mode-selector")).toBeVisible({
      timeout: 5000,
    });
  }

  async goToHubTab() {
    await this.page.getByRole("link", { name: "Hub" }).click();
  }

  async clickBackButton() {
    await this.page.getByRole("button", { name: "Back" }).click();
  }

  async selectTemplate(templateName: string) {
    await this.page.getByRole("img", { name: templateName }).click();
  }

  async goToHubAndSelectTemplate(templateName: "Next.js Template") {
    await this.goToHubTab();
    await this.selectTemplate(templateName);
    await this.goToAppsTab();
  }
}
