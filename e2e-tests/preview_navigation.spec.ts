import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "preview navigation - forward and back buttons work",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a multi-page app
    await po.sendPrompt("tc=multi-page-app");

    // Wait for the preview iframe to be visible
    await po.expectPreviewIframeIsVisible();

    // Verify we're on the home page
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().locator('[data-testid="home-page"]'),
    ).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Click the link to go to the about page
    await iframe
      .contentFrame()
      .locator('[data-testid="go-to-about-link"]')
      .click();

    // Verify we're on the about page
    await expect(
      iframe.contentFrame().locator('[data-testid="about-page"]'),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Now click the back button in the preview panel
    await po.clickPreviewNavigateBack();

    // Verify we're back on the home page
    await expect(
      iframe.contentFrame().locator('[data-testid="home-page"]'),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Click the forward button
    await po.clickPreviewNavigateForward();

    // Verify we're on the about page again
    await expect(
      iframe.contentFrame().locator('[data-testid="about-page"]'),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  },
);
