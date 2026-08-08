import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test.describe("Back button navigation", () => {
  test("returns from app details to home", async ({ po }) => {
    await po.setUp({ autoApprove: true });

    await po.sendPrompt("create a test app");

    await po.navigation.goToMyAppsGallery();

    const gallery = po.page.getByTestId("my-apps-gallery");
    await expect(gallery).toBeVisible({ timeout: Timeout.MEDIUM });
    const showcaseCards = await gallery
      .getByTestId(/^app-showcase-card-/)
      .all();
    expect(showcaseCards.length).toBeGreaterThan(0);
    await showcaseCards[0].click();

    const appDetailsPage = po.page.getByTestId("app-details-page");
    await expect(appDetailsPage).toBeVisible({ timeout: Timeout.MEDIUM });

    await po.navigation.clickBackButton();

    await expect(appDetailsPage).toBeHidden({ timeout: Timeout.MEDIUM });
    await expect(gallery).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.page.waitForTimeout(500);
    await expect(appDetailsPage).toBeHidden();
  });
});
