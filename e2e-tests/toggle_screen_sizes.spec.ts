import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Toggle Screen Size Tests", () => {
  async function setupApp(po: any) {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=write-index");

    const iframe = po.getPreviewIframeElement();
    const frame = await iframe.contentFrame();

    await expect(frame.getByText("Testing:write-index!")).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
  }

  testSkipIfWindows(
    "should open and close device mode popover",
    async ({ po }) => {
      test.setTimeout(Timeout.EXTRA_LONG * 1.5);
      await setupApp(po);

      // Click the device mode button to open popover
      const deviceModeButton = po.page.locator(
        '[data-testid="device-mode-button"]',
      );
      await deviceModeButton.click();

      // Verify popover is visible with device options
      const originalButton = po.page.locator('[aria-label="Desktop view"]');
      await expect(originalButton).toBeVisible();

      // Close popover by clicking the button again
      await deviceModeButton.click();

      // Verify popover is closed
      await expect(originalButton).toBeHidden();
    },
  );

  testSkipIfWindows("should switch between device modes", async ({ po }) => {
    test.setTimeout(Timeout.EXTRA_LONG * 1.5);
    await setupApp(po);

    const deviceModeButton = po.page.locator(
      '[data-testid="device-mode-button"]',
    );

    const previewIframe = po.page.locator(
      '[data-testid="preview-iframe-element"]',
    );

    // Switch to tablet mode
    await deviceModeButton.click();
    await po.page.locator('[aria-label="Tablet view"]').click();

    // Wait for the iframe width to change to tablet size (768px)
    await expect(previewIframe).toHaveAttribute("style", /width:\s*768px/);

    // Verify iframe has tablet dimensions
    const tabletWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    expect(tabletWidth).toBe("768");

    // Switch to mobile mode
    await deviceModeButton.click();
    await po.page.locator('[aria-label="Mobile view"]').click();

    // Wait for the iframe width to change to mobile size (375px)
    await expect(previewIframe).toHaveAttribute("style", /width:\s*375px/);

    // Verify iframe has mobile dimensions
    const mobileWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    expect(mobileWidth).toBe("375");
  });
});
