import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
const fs = require("fs");
const path = require("path");

testSkipIfWindows("edit style of one selected component", async ({ po }) => {
  await po.setUpDyadPro();
  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  // Select a component
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  // Wait for the toolbar to appear (check for the Margin button which is always visible)
  const marginButton = po.page.getByRole("button", { name: "Margin" });
  await expect(marginButton).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Ensure the toolbar has proper coordinates before clicking
  await expect(async () => {
    const box = await marginButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Click on margin button to open the margin popover
  await marginButton.click();

  // Wait for the popover to fully open by checking for the popover content container
  const marginDialog = po.page
    .locator('[role="dialog"]')
    .filter({ hasText: "Margin" });
  await expect(marginDialog).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Edit margin - set horizontal margin
  const marginXInput = po.page.getByLabel("Horizontal");
  await marginXInput.fill("20");

  // Edit margin - set vertical margin
  const marginYInput = po.page.getByLabel("Vertical");
  await marginYInput.fill("10");

  // Close the popover by clicking outside or pressing escape
  await po.page.keyboard.press("Escape");

  // Check if the changes are applied to UI by verifying the visual changes dialog appears
  await expect(po.page.getByText(/\d+ component[s]? modified/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Save the changes
  await po.page.getByRole("button", { name: "Save Changes" }).click();

  // Wait for the success toast
  await po.waitForToastWithText("Visual changes saved to source files");

  // Verify that the changes are applied to codebase
  await po.snapshotAppFiles({
    name: "visual-editing-single-component-margin",
    files: ["src/pages/Index.tsx"],
  });
});

testSkipIfWindows("edit text of the selected component", async ({ po }) => {
  await po.setUpDyadPro();
  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  // Click on component that contains static text
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  // Wait for the toolbar to appear (check for the Margin button which is always visible)
  await expect(po.page.getByRole("button", { name: "Margin" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Get the iframe and access the content
  const iframe = po.getPreviewIframeElement();
  const frame = iframe.contentFrame();

  // Find the heading element in the iframe
  const heading = frame.getByRole("heading", {
    name: "Welcome to Your Blank App",
  });

  await heading.dblclick();

  // Wait for contentEditable to be enabled
  await expect(async () => {
    const isEditable = await heading.evaluate(
      (el) => (el as HTMLElement).isContentEditable,
    );
    expect(isEditable).toBe(true);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Clear the existing text and type new text
  await heading.press("Meta+A");
  await heading.type("Hello from E2E Test");

  // Click outside to finish editing
  await frame.locator("body").click({ position: { x: 10, y: 10 } });

  // Verify the changes are applied in the UI
  await expect(frame.getByText("Hello from E2E Test")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Verify the visual changes dialog appears
  await expect(po.page.getByText(/\d+ component[s]? modified/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Save the changes
  await po.page.getByRole("button", { name: "Save Changes" }).click();

  // Wait for the success toast
  await po.waitForToastWithText("Visual changes saved to source files");

  // Verify that the changes are applied to the codebase
  await po.snapshotAppFiles({
    name: "visual-editing-text-content",
    files: ["src/pages/Index.tsx"],
  });
});

testSkipIfWindows("discard changes", async ({ po }) => {
  await po.setUpDyadPro();
  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  // Select a component
  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  // Wait for the toolbar to appear (check for the Margin button which is always visible)
  const marginButton = po.page.getByRole("button", { name: "Margin" });
  await expect(marginButton).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Ensure the toolbar has proper coordinates before clicking
  await expect(async () => {
    const box = await marginButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Click on margin button to open the margin popover
  await marginButton.click();

  // Wait for the popover to fully open by checking for the popover content container
  const marginDialog = po.page
    .locator('[role="dialog"]')
    .filter({ hasText: "Margin" });
  await expect(marginDialog).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Edit margin
  const marginXInput = po.page.getByLabel("Horizontal");
  await marginXInput.fill("30");

  const marginYInput = po.page.getByLabel("Vertical");
  await marginYInput.fill("30");

  // Close the popover
  await po.page.keyboard.press("Escape");

  // Wait for the popover to close
  await expect(marginDialog).not.toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Check if the changes are applied to UI
  await expect(po.page.getByText(/\d+ component[s]? modified/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Take a snapshot of the app files before discarding
  const appPathBefore = await po.getCurrentAppPath();
  const appFileBefore = fs.readFileSync(
    path.join(appPathBefore, "src", "pages", "Index.tsx"),
    "utf-8",
  );

  // Discard the changes
  await po.page.getByRole("button", { name: "Discard" }).click();

  // Verify the visual changes dialog is gone
  await expect(po.page.getByText(/\d+ component[s]? modified/)).not.toBeVisible(
    { timeout: Timeout.MEDIUM },
  );

  // Verify that the changes are NOT applied to codebase
  const appFileAfter = fs.readFileSync(
    path.join(appPathBefore, "src", "pages", "Index.tsx"),
    "utf-8",
  );

  // The file content should be the same as before
  expect(appFileAfter).toBe(appFileBefore);
});
