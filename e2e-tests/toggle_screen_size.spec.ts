import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test.describe("Toggle Screen Size Tests", () => {
  test("Open and close screen size menu", async ({ po }) => {
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

    // Click the screen size toggle button
    const screenSizeButton = po.page.locator(
      '[data-testid="preview-screen-size-button"]',
    );
    await expect(screenSizeButton).toBeVisible();
    await screenSizeButton.click();

    // Verify screen size menu is visible
    const screenSizeMenu = po.page.locator("text=Select Device");
    await expect(screenSizeMenu).toBeVisible();

    // Close the menu by clicking the button again
    await screenSizeButton.click();

    // Verify menu is closed (screen should reset to 100%)
    const widthInput = po.page.locator('input[placeholder="Width"]');
    await expect(widthInput).not.toBeVisible();
  });

  test("Select device preset and verify iframe resize", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview content to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    // Open screen size menu
    const screenSizeButton = po.page.locator(
      '[data-testid="preview-screen-size-button"]',
    );
    await screenSizeButton.click();

    // Click device dropdown
    await po.page.locator("text=Select Device").click();

    // Select iPhone SE (375x667)
    await po.page.locator("text=iPhone SE").first().click();

    // Verify device name is displayed in dropdown
    const deviceDropdown = po.page.locator("text=iPhone SE").first();
    await expect(deviceDropdown).toBeVisible();

    // Verify width and height inputs show correct values
    const widthInput = po.page.locator('input[placeholder="Width"]');
    const heightInput = po.page.locator('input[placeholder="Height"]');
    await expect(widthInput).toHaveValue("375");
    await expect(heightInput).toHaveValue("667");

    // Verify iframe has the correct dimensions
    const box = await iframe.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);
  });

  test("Custom width and height input", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview content to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    // Open screen size menu
    const screenSizeButton = po.page.locator(
      '[data-testid="preview-screen-size-button"]',
    );
    await screenSizeButton.click();

    // Input custom dimensions
    const widthInput = po.page.locator('input[placeholder="Width"]');
    const heightInput = po.page.locator('input[placeholder="Height"]');

    await widthInput.fill("600");
    await heightInput.fill("900");

    // Verify values are set
    await expect(widthInput).toHaveValue("600");
    await expect(heightInput).toHaveValue("900");

    // Verify "px" label is visible (not showing % anymore)
    const pxLabel = po.page.locator('span:text("px")').first();
    await expect(pxLabel).toBeVisible();
  });

  test("Rotate device dimensions", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview content to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    // Open screen size menu
    const screenSizeButton = po.page.locator(
      '[data-testid="preview-screen-size-button"]',
    );
    await screenSizeButton.click();

    // Click device dropdown and select a device
    await po.page.locator("text=Select Device").click();
    await po.page.locator("text=iPhone SE").first().click();

    // Get initial dimensions
    const widthInput = po.page.locator('input[placeholder="Width"]');
    const heightInput = po.page.locator('input[placeholder="Height"]');
    const widthBefore = await widthInput.inputValue();
    const heightBefore = await heightInput.inputValue();

    // Click rotate button
    const rotateButton = po.page.locator('[title="Rotate"]');
    await rotateButton.click();

    // Verify dimensions swapped
    const widthAfter = await widthInput.inputValue();
    const heightAfter = await heightInput.inputValue();

    expect(widthAfter).toBe(heightBefore);
    expect(heightAfter).toBe(widthBefore);
  });

  test("Open manage presets dialog", async ({ po }) => {
    test.setTimeout(180000); // 3 minutes
    await po.setUp({ autoApprove: true });

    // Create a test app using fixture
    await po.sendPrompt("tc=write-index");

    // Wait for preview content to load
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Testing:write-index!"),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });

    // Open screen size menu
    const screenSizeButton = po.page.locator(
      '[data-testid="preview-screen-size-button"]',
    );
    await screenSizeButton.click();

    // Click device dropdown
    await po.page.locator("text=Select Device").click();

    // Click "Manage Presets..." option
    await po.page.locator("text=Manage Presets...").click();

    // Verify dialog opened
    await expect(po.page.locator("text=Manage Device Presets")).toBeVisible();

    // Verify dialog description is visible
    await expect(
      po.page.locator("text=Add, edit, or delete custom device presets"),
    ).toBeVisible();

    // Verify default presets are loaded
    await expect(po.page.locator("text=iPhone SE").first()).toBeVisible();
    await expect(po.page.locator("text=iPad Air").first()).toBeVisible();

    // Close dialog
    await po.page.locator('button:text("Close")').last().click();

    // Verify dialog is closed
    await expect(
      po.page.locator("text=Manage Device Presets"),
    ).not.toBeVisible();
  });
});
