import { test, Timeout } from "./helpers/test_helper";
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

    // Click the favorite button — hover first like a real user would,
    // then wait for the app to finish starting before the click resolves.
    const favoriteButton = appItem
      .locator("xpath=..")
      .locator('[data-testid="favorite-button"]');
    await expect(favoriteButton).toBeVisible();
    await appItem.hover();
    await favoriteButton.click();

    // Check that the star is filled (favorited).
    // Use a longer timeout because the addToFavorite IPC call may be waiting
    // for the app startup lock to release.
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });
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
    await appItem.hover();
    await favoriteButton.click();

    // Check that the star is filled (favorited)
    const star = favoriteButton.locator("svg");
    await expect(star).toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });

    // Now, remove from favorite
    const unfavoriteButton = appItem
      .locator("xpath=..")
      .locator('[data-testid="favorite-button"]');
    await expect(unfavoriteButton).toBeVisible();
    await appItem.hover();
    await unfavoriteButton.click();

    // Check that the star is not filled (unfavorited)
    // Match fill-[#6c55dc] only at start or after whitespace (not as part of hover:fill-...)
    await expect(star).not.toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/, {
      timeout: Timeout.MEDIUM,
    });
  });
});
