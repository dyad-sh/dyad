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
    // Chat is now nested under Apps. Click Apps to show the sidebar chat list,
    // then click the most recent chat to navigate to the actual /chat page.
    await this.page.getByRole("link", { name: "Apps" }).click();
    // Wait for the chat list to appear in the sidebar
    const chatList = this.page.getByTestId("chat-list-container");
    await expect(chatList).toBeVisible({ timeout: 5000 });
    // Click the first chat to navigate to /chat
    await chatList
      .locator('[data-slot="sidebar-menu-item"] button')
      .first()
      .click();
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
