import { expect, type Page } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
const fs = require("fs");
const path = require("path");

async function saveVisualChanges(page: Page) {
  const saveButton = page.getByRole("button", { name: "Save Changes" });

  await expect(async () => {
    await expect(saveButton).toBeVisible({ timeout: 1_000 });
    await expect(saveButton).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: Timeout.MEDIUM });

  await saveButton.click();
}

testSkipIfWindows("discard style edits and save text edits", async ({ po }) => {
  await po.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  const frame = po.previewPanel.getPreviewIframeElement().contentFrame();
  const heading = frame.getByRole("heading", {
    name: "Welcome to Your Blank App",
  });
  await heading.click();

  const marginButton = po.page.getByRole("button", { name: "Margin" });
  await expect(marginButton).toBeVisible({ timeout: Timeout.MEDIUM });
  await marginButton.click();

  const marginDialog = po.page
    .locator('[role="dialog"]')
    .filter({ hasText: "Margin" });
  await expect(marginDialog).toBeVisible({ timeout: Timeout.LONG });
  await po.page.getByLabel("Horizontal").fill("30");
  await po.page.getByLabel("Vertical").fill("30");
  await po.page.keyboard.press("Escape");

  const appPath = await po.appManagement.getCurrentAppPath();
  const sourcePath = path.join(appPath, "src", "pages", "Index.tsx");
  const sourceBeforeDiscard = fs.readFileSync(sourcePath, "utf-8");
  await expect(po.page.getByText(/\d+ component[s]? modified/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.page.getByRole("button", { name: "Discard" }).click();
  await expect(po.page.getByText(/\d+ component[s]? modified/)).not.toBeVisible(
    { timeout: Timeout.MEDIUM },
  );
  expect(fs.readFileSync(sourcePath, "utf-8")).toBe(sourceBeforeDiscard);

  await po.previewPanel.clickPreviewPickElement();
  await heading.click();
  await expect(po.page.getByRole("button", { name: "Margin" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await heading.dblclick();
  await expect(async () => {
    expect(
      await heading.evaluate((element) =>
        Boolean((element as HTMLElement).isContentEditable),
      ),
    ).toBe(true);
  }).toPass({ timeout: Timeout.MEDIUM });

  await heading.press("Meta+A");
  await heading.type("Hello from E2E Test");
  await frame.locator("body").click({ position: { x: 10, y: 10 } });
  await expect(frame.getByText("Hello from E2E Test")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  await saveVisualChanges(po.page);
  await po.toastNotifications.waitForToastWithText(
    "Visual changes saved to source files",
  );
  await po.snapshotAppFiles({
    name: "visual-editing-text-content",
    files: ["src/pages/Index.tsx"],
  });
});

testSkipIfWindows("swap image via URL", async ({ po }) => {
  await po.sendPrompt("tc=local-agent/visual-editing-image");
  await po.previewPanel.clickPreviewPickElement();

  const heroImage = po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("img", { name: "Hero image" });
  await expect(heroImage).toBeVisible({ timeout: Timeout.LONG });
  await heroImage.click();

  const marginButton = po.page.getByRole("button", { name: "Margin" });
  await expect(marginButton).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(async () => {
    const box = await marginButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  const swapImageButton = po.page.getByRole("button", {
    name: "Swap Image",
  });
  await expect(swapImageButton).toBeVisible({ timeout: Timeout.LONG });
  await swapImageButton.click();

  const imagePopover = po.page
    .locator('[role="dialog"]')
    .filter({ hasText: "Image Source" });
  await expect(imagePopover).toBeVisible({ timeout: Timeout.LONG });
  await po.page
    .getByLabel("Image URL")
    .fill(`http://localhost:${FAKE_LLM_BASE_PORT}/test-image.png`);
  await po.page.getByRole("button", { name: "Apply" }).click();
  await po.page.keyboard.press("Escape");

  await expect(po.page.getByText(/\d+ component[s]? modified/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await saveVisualChanges(po.page);
  await po.toastNotifications.waitForToastWithText(
    "Visual changes saved to source files",
  );
  await po.snapshotAppFiles({
    name: "visual-editing-swap-image",
    files: ["src/pages/Index.tsx"],
  });
});
