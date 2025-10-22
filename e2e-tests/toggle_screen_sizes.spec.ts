import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Toggle Screen Size Tests", () => {
  test("should open and close device mode popover", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    // Click the device mode button to open popover
    const deviceModeButton = po.page.locator(
      '[data-testid="device-mode-button"]',
    );
    await deviceModeButton.click();

    // Verify popover is visible with device options
    const originalButton = po.page.locator('[aria-label="Original size"]');
    await expect(originalButton).toBeVisible();

    // Close popover by clicking the button again
    await deviceModeButton.click();

    // Verify popover is closed
    await expect(originalButton).not.toBeVisible();
  });

  test("should switch between device modes", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    const deviceModeButton = po.page.locator(
      '[data-testid="device-mode-button"]',
    );

    // Open popover and select desktop mode
    await deviceModeButton.click();
    await po.page.locator('[aria-label="Desktop view"]').click();

    // Wait a moment for the device mode to apply
    await po.page.waitForTimeout(300);

    // Verify iframe has desktop dimensions
    const previewIframe = po.page.locator(
      '[data-testid="preview-iframe-element"]',
    );
    const width = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    const height = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.height.replace("px", ""),
    );
    expect(width).toBe("1920");
    expect(height).toBe("1080");

    // Switch to tablet mode
    await po.page.locator('[aria-label="Tablet view"]').click();

    await po.page.waitForTimeout(300);

    // Verify iframe has mobile dimensions
    const tabletWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    const TabletHeight = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.height.replace("px", ""),
    );
    expect(tabletWidth).toBe("768");
    expect(TabletHeight).toBe("1024");

    // Switch to mobile mode
    await po.page.locator('[aria-label="Mobile view"]').click();

    await po.page.waitForTimeout(300);

    // Verify iframe has mobile dimensions
    const mobileWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    const mobileHeight = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.height.replace("px", ""),
    );
    expect(mobileWidth).toBe("375");
    expect(mobileHeight).toBe("667");
  });

  test("should reset to original size when closing popover", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    const deviceModeButton = po.page.locator(
      '[data-testid="device-mode-button"]',
    );
    const previewIframe = po.page.locator(
      '[data-testid="preview-iframe-element"]',
    );

    // Select desktop mode
    await deviceModeButton.click();
    await po.page.locator('[aria-label="Desktop view"]').click();

    await po.page.waitForTimeout(300);

    // Verify desktop mode is active
    const desktopWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.style.width.replace("px", ""),
    );
    expect(desktopWidth).toBe("1920");

    // Close popover by clicking the device mode button
    await deviceModeButton.click();

    await po.page.waitForTimeout(300);

    // Verify iframe is back to original responsive mode (full width)
    const hasFullWidth = await previewIframe.evaluate((el: HTMLIFrameElement) =>
      el.className.includes("w-full"),
    );
    expect(hasFullWidth).toBe(true);
  });
});
