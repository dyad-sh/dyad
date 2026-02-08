/**
 * Page object for toast notifications.
 * Handles waiting for, asserting, and dismissing toasts.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class ToastNotifications {
  constructor(public page: Page) {}

  async expectNoToast() {
    await expect(this.page.locator("[data-sonner-toast]")).toHaveCount(0);
  }

  async waitForToast(
    type?: "success" | "error" | "warning" | "info",
    timeout = 5000,
  ) {
    const selector = type
      ? `[data-sonner-toast][data-type="${type}"]`
      : "[data-sonner-toast]";

    await this.page.waitForSelector(selector, { timeout });
  }

  async waitForToastWithText(text: string, timeout = Timeout.MEDIUM) {
    await this.page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, {
      timeout,
    });
  }

  async assertToastVisible(type?: "success" | "error" | "warning" | "info") {
    const selector = type
      ? `[data-sonner-toast][data-type="${type}"]`
      : "[data-sonner-toast]";

    await expect(this.page.locator(selector)).toBeVisible();
  }

  async assertToastWithText(text: string) {
    await expect(
      this.page.locator(`[data-sonner-toast]:has-text("${text}")`),
    ).toBeVisible();
  }

  async dismissAllToasts() {
    // Click all close buttons if they exist
    const closeButtons = this.page.locator(
      "[data-sonner-toast] button[data-close-button]",
    );
    while ((await closeButtons.count()) > 0) {
      await closeButtons
        .first()
        .click()
        .catch(() => {});
    }
  }
}
