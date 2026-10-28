import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import type { PageObject } from "./helpers/page-objects";

test.describe("Toggle Screen Size Tests", () => {
  async function selectDeviceMode(po: PageObject, mode: "Tablet" | "Mobile") {
    await po.page.getByTestId("device-mode-button").click();
    const option = po.page.getByRole("button", { name: `${mode} view` });
    await expect(option).toBeVisible();
    // The popup scales into place. Wait for its opening animation so the
    // pointer lands on the requested option rather than its moving neighbor.
    await po.page
      .locator('[data-slot="popover-content"]')
      .filter({ has: option })
      .evaluate(async (popup) => {
        await Promise.all(
          popup.getAnimations().map((animation) => animation.finished),
        );
      });
    await option.click();
    await expect(option).toBeHidden();
  }

  async function setupApp(po: PageObject) {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=write-index");

    const iframe = po.previewPanel.getPreviewIframeElement();
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

    const previewIframe = po.page.locator(
      '[data-testid="preview-iframe-element"]',
    );

    // Switch to tablet mode
    await selectDeviceMode(po, "Tablet");

    // Wait for the iframe width to change to tablet size (768px)
    await expect(previewIframe).toHaveAttribute("style", /width:\s*768px/);

    // Verify iframe has tablet dimensions
    const tabletWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    expect(tabletWidth).toBe("768");

    // Switch to mobile mode
    await selectDeviceMode(po, "Mobile");

    // Wait for the iframe width to change to mobile size (375px)
    await expect(previewIframe).toHaveAttribute("style", /width:\s*375px/);

    // Verify iframe has mobile dimensions
    const mobileWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    expect(mobileWidth).toBe("375");
  });

  testSkipIfWindows(
    "should persist device mode after rebuild",
    async ({ po }) => {
      test.setTimeout(Timeout.EXTRA_LONG * 2);
      await setupApp(po);

      const previewIframe = po.page.locator(
        '[data-testid="preview-iframe-element"]',
      );

      // Switch to mobile mode
      await selectDeviceMode(po, "Mobile");
      await expect(previewIframe).toHaveAttribute("style", /width:\s*375px/);

      // Trigger rebuild
      await po.previewPanel.clickRebuild();
      await expect(po.previewPanel.locateLoadingAppPreview()).toBeVisible();
      await expect(po.previewPanel.locateLoadingAppPreview()).not.toBeVisible({
        timeout: Timeout.EXTRA_LONG,
      });

      // Verify mobile mode persists after rebuild
      await expect(previewIframe).toHaveAttribute("style", /width:\s*375px/, {
        timeout: Timeout.LONG,
      });
    },
  );
});
