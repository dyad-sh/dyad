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
  await po.sendPrompt("hi");

  // Wait for the preview iframe to be visible
  await po.expectPreviewIframeIsVisible();

  const addressBarPath = po.page.getByTestId("preview-address-bar-path");

  // Wait for the address bar to be visible
  await expect(addressBarPath).toBeVisible({ timeout: Timeout.MEDIUM });

  // Initially should be at root
  await expect(addressBarPath).toHaveText("/", { timeout: Timeout.MEDIUM });

  // Navigate to a different route using JavaScript
  const testRoute = "/test-route";
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .locator("body")
    .evaluate((body, route) => {
      // This triggers a pushState event that updates the navigation history
      window.history.pushState({}, "", route);
      // Dispatch a message to notify the parent about the navigation
      window.parent.postMessage(
        { type: "pushState", payload: { newUrl: window.location.href } },
        "*",
      );
    }, testRoute);

  // Wait for address bar to update
  await expect(addressBarPath).toHaveText(testRoute, {
    timeout: Timeout.MEDIUM,
  });

  // Click refresh
  await po.clickPreviewRefresh();

  // Verify the route is preserved after refresh
  await expect(addressBarPath).toHaveText(testRoute, {
    timeout: Timeout.MEDIUM,
  });
});
