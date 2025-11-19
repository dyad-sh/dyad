import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Favorite App Tests", () => {
  test("Add app to favorite", async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a test app
    await po.sendPrompt("create a test app");
    await po.goToAppsTab();

    // Get the app name from the UI (randomly generated)
    const appItems = await po.page.getByTestId(/^app-list-item-/).all();
    expect(appItems.length).toBeGreaterThan(0);
    const firstAppItem = appItems[0];
    const testId = await firstAppItem.getAttribute("data-testid");
    const appName = testId!.replace("app-list-item-", "");

    // Get the app item (assuming it's not favorited initially)
    const appItem = po.page.locator(`[data-testid="app-list-item-${appName}"]`);
    await expect(appItem).toBeVisible();

    // Click the favorite button
    const favoriteButton = appItem
      .locator("xpath=..")
      .locator('[data-testid="favorite-button"]');
    await expect(favoriteButton).toBeVisible();
    await favoriteButton.click();

    // Check that the star is filled (favorited)
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/fill-\[#6c55dc\]/);
  });

  test("Remove app from favorite", async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a test app
    await po.sendPrompt("create a test app");
    await po.goToAppsTab();

    // Get the app name from the UI
    const appItems = await po.page.getByTestId(/^app-list-item-/).all();
    expect(appItems.length).toBeGreaterThan(0);
    const firstAppItem = appItems[0];
    const testId = await firstAppItem.getAttribute("data-testid");
    const appName = testId!.replace("app-list-item-", "");

    // Get the app item
    const appItem = po.page.locator(`[data-testid="app-list-item-${appName}"]`);

    // First, add to favorite
    const favoriteButton = appItem
      .locator("xpath=..")
      .locator('[data-testid="favorite-button"]');
    await favoriteButton.click();

    // Check that the star is filled (favorited)
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/fill-\[#6c55dc\]/);

    // Now, remove from favorite
    const unfavoriteButton = appItem
      .locator("xpath=..")
      .locator('[data-testid="favorite-button"]');
    await expect(unfavoriteButton).toBeVisible();
    await unfavoriteButton.click();

    // Check that the star is not filled (unfavorited)
    await expect(star).not.toHaveClass(/fill-\[#6c55dc\]/);
  });
});
