import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Favorite App Tests", () => {
  test("Add app to favorite from app details", async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a test app
    await po.sendPrompt("create a test app");
    await po.navigation.goToAppsTab();

    // Get the app name from the UI (randomly generated)
    const appItems = await po.page.getByTestId(/^app-list-item-/).all();
    expect(appItems.length).toBeGreaterThan(0);
    const firstAppItem = appItems[0];

    // Click on the app to go to app details
    await firstAppItem.click();

    // Wait for app details page to load
    const appDetailsPage = po.page.getByTestId("app-details-page");
    await expect(appDetailsPage).toBeVisible({ timeout: Timeout.MEDIUM });

    // Click the favorite button in app details
    const favoriteButton = appDetailsPage.locator(
      '[data-testid="favorite-button"]',
    );
    await expect(favoriteButton).toBeVisible();
    await favoriteButton.click();

    // Check that the star is filled (favorited)
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });
  });

  test("Remove app from favorite from app details", async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a test app
    await po.sendPrompt("create a test app");
    await po.navigation.goToAppsTab();

    // Get the app name from the UI
    const appItems = await po.page.getByTestId(/^app-list-item-/).all();
    expect(appItems.length).toBeGreaterThan(0);
    const firstAppItem = appItems[0];

    // Click on the app to go to app details
    await firstAppItem.click();

    // Wait for app details page to load
    const appDetailsPage = po.page.getByTestId("app-details-page");
    await expect(appDetailsPage).toBeVisible({ timeout: Timeout.MEDIUM });

    // First, add to favorite
    const favoriteButton = appDetailsPage.locator(
      '[data-testid="favorite-button"]',
    );
    await favoriteButton.click();

    // Check that the star is filled (favorited)
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });

    // Now, remove from favorite
    await favoriteButton.click();

    // Check that the star is not filled (unfavorited)
    await expect(star).not.toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });
  });
});
