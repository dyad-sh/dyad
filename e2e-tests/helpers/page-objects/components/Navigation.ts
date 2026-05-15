/**
 * Page object for navigation between tabs and pages.
 * Handles tab navigation and back button.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

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
    await expect(async () => {
      const isAppsLandingVisible = await this.page
        .getByText("Build a new app")
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const isAppListVisible = await this.page
        .getByRole("button", { name: "New App" })
        .isVisible({ timeout: 500 })
        .catch(() => false);

      expect(isAppsLandingVisible || isAppListVisible).toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });
  }

  async goToChatTab() {
    if (await this.chatInputVisible()) return;
    await this.openAppsPane();
    if (await this.appListVisible()) {
      await this.openFirstAppViaList();
    } else {
      await this.openFirstChatOrCreateNew();
    }
    await this.waitForChatInput();
  }

  private async chatInputVisible() {
    return this.page.getByTestId("chat-input-container").isVisible();
  }

  private async openAppsPane() {
    const appsLink = this.page.getByRole("link", { name: "Apps" });
    await expect(appsLink).toBeVisible({ timeout: 60000 });
    await appsLink.click();

    const appList = this.page.getByTestId("app-list-container");
    const chatList = this.page.getByTestId("chat-list-container");
    await expect(async () => {
      expect((await chatList.isVisible()) || (await appList.isVisible())).toBe(
        true,
      );
    }).toPass({ timeout: 60000 });
  }

  private async appListVisible() {
    return this.page.getByTestId("app-list-container").isVisible();
  }

  private async openFirstAppViaList() {
    const appListItem = this.page.locator('[data-testid^="app-list-item-"]');
    await expect(appListItem.first()).toBeVisible({ timeout: 60000 });
    await appListItem.first().click();

    const openInChatButton = this.page.getByRole("button", {
      name: "Open in Chat",
    });
    await expect(openInChatButton).toBeVisible({ timeout: 60000 });
    await expect(openInChatButton).toBeEnabled({ timeout: 60000 });
    await openInChatButton.click();
  }

  private async openFirstChatOrCreateNew() {
    const chatList = this.page.getByTestId("chat-list-container");
    await expect(chatList).toBeVisible({ timeout: 60000 });

    const existingChat = this.page.locator('[data-testid^="chat-list-item-"]');
    const emptyChatList = this.page.getByText("No chats found", {
      exact: true,
    });
    await expect(async () => {
      expect(
        (await existingChat.count()) > 0 || (await emptyChatList.isVisible()),
      ).toBe(true);
    }).toPass({ timeout: 60000 });

    if ((await existingChat.count()) > 0) {
      await existingChat.first().click();
      return;
    }

    await this.page.getByTestId("new-chat-button").click();
  }

  private async waitForChatInput() {
    await expect(this.page.getByTestId("chat-input-container")).toBeVisible({
      timeout: 60000,
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
