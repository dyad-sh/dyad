import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("refresh app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  // Drop the document.body inside the contentFrame to make
  // sure refresh works.
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .locator("body")
    .evaluate((body) => {
      body.remove();
    });

  await po.clickPreviewRefresh();
  await po.snapshotPreview();
});

testSkipIfWindows("refresh preserves current route", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create a multi-page app with react-router navigation
  await po.sendPrompt("tc=multi-page");

  // Wait for the preview iframe to be visible and loaded
  await po.expectPreviewIframeIsVisible();

  // Wait for the Home Page content to be visible in the iframe
  await expect(
    po.getPreviewIframeElement().contentFrame().getByText("Home Page"),
  ).toBeVisible({ timeout: Timeout.LONG });

  // Click on the navigation link to go to /about (realistic user behavior)
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByText("Go to About Page")
    .click();

  // Wait for the About Page content to be visible
  await expect(
    po.getPreviewIframeElement().contentFrame().getByText("About Page"),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  // Click refresh
  await po.clickPreviewRefresh();

  // Verify the route is preserved after refresh - About Page should still be visible
  await expect(
    po.getPreviewIframeElement().contentFrame().getByText("About Page"),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  // Wait to see if the page stays on About Page (reproducing local issue)
  await po.page.waitForTimeout(10000);

  // Verify it's STILL on About Page after waiting - check that About Page heading is visible
  // and the Home Page heading is not (use getByRole to match the heading, not the link text)
  await expect(
    po
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "About Page" }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(
    po
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "Home Page" }),
  ).not.toBeVisible();
});
