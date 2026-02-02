import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// This test reproduces a regression from PR #2336 where navigating back to root
// doesn't clear the preserved URL, causing the wrong route to load after restart
testSkipIfWindows(
  "restart after navigating back to root should stay on root",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });

    // Create a multi-page app with react-router navigation
    await po.sendPrompt("tc=multi-page");

    // Wait for the preview iframe to be visible and loaded
    await po.expectPreviewIframeIsVisible();

    // Wait for the Home Page content to be visible in the iframe
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.LONG });

    // Navigate to /about by clicking the link
    await po
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Go to About Page")
      .click();

    // Wait for About Page to be visible
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "About Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Navigate back to / by clicking the link (triggers pushState with pathname "/")
    // This is the scenario that triggers the bug - pushState to "/" doesn't clear preserved URL
    await po
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Go to Home Page")
      .click();

    // Wait for Home Page to be visible
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Verify address bar shows root path
    await expect(po.page.getByTestId("preview-address-bar-path")).toHaveText(
      "/",
    );

    // Now restart - this causes PreviewIframe component to remount
    // The bug: preserved URL (/about) is not cleared when navigating back to /,
    // so after remount it loads /about instead of /
    await po.clickRestart();

    // Wait for the app to restart and load
    await expect(po.locateLoadingAppPreview()).toBeVisible();
    await expect(po.locateLoadingAppPreview()).not.toBeVisible({
      timeout: Timeout.LONG,
    });

    // After restart, the page should still be on Home Page (/)
    // BUG: Due to the regression, it might incorrectly load /about
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "Home Page" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      po
        .getPreviewIframeElement()
        .contentFrame()
        .getByRole("heading", { name: "About Page" }),
    ).not.toBeVisible();
  },
);

testSkipIfWindows("restart app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  await po.clickRestart();
  await expect(po.locateLoadingAppPreview()).toBeVisible();
  await expect(po.locateLoadingAppPreview()).not.toBeVisible({
    timeout: Timeout.LONG,
  });

  await po.snapshotPreview();
});
