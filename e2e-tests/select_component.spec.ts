import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("select component", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.sendPrompt("[dump] make it smaller");
  await po.previewPanel.snapshotPreview();
  await expect(
    po.previewPanel.getSelectedComponentsDisplay(),
  ).not.toBeVisible();

  await po.snapshotServerDump("all-messages");

  // Send one more prompt to make sure it's a normal message.
  await po.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("select multiple components", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByText("Made with Coney")
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.sendPrompt("[dump] make both smaller");
  await po.previewPanel.snapshotPreview();
  await expect(
    po.previewPanel.getSelectedComponentsDisplay(),
  ).not.toBeVisible();

  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("deselect component", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  // Deselect the component and make sure the state has reverted
  await po.previewPanel.clickDeselectComponent();

  await po.previewPanel.snapshotPreview();
  await expect(
    po.previewPanel.getSelectedComponentsDisplay(),
  ).not.toBeVisible();

  // Send one more prompt to make sure it's a normal message.
  await po.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows(
  "deselect individual component from multiple",
  async ({ po }) => {
    await po.setUp();
    await po.sendPrompt("tc=basic");
    await po.previewPanel.clickTogglePreviewPanel();
    await po.previewPanel.clickPreviewPickElement();

    await po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "Welcome to Your Blank App" })
      .click();

    await po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Made with Coney")
      .click();

    await po.previewPanel.snapshotSelectedComponentsDisplay();

    await po.previewPanel.clickDeselectComponent({ index: 0 });

    await po.previewPanel.snapshotPreview();
    await po.previewPanel.snapshotSelectedComponentsDisplay();

    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible();
  },
);

testSkipIfWindows("upgrade app to select component", async ({ po }) => {
  await po.setUp();
  await po.importApp("select-component");
  await po.appManagement.getTitleBarAppNameButton().click();
  await po.appManagement.clickAppUpgradeButton({
    upgradeId: "component-tagger",
  });
  await po.appManagement.expectAppUpgradeButtonIsNotVisible({
    upgradeId: "component-tagger",
  });
  await po.snapshotAppFiles({ name: "app-upgraded" });
  await po.appManagement.clickOpenInChatButton();
  // There should be another version from the upgrade being committed.
  await expect(po.page.getByText("Version 2")).toBeVisible();
  await po.clickRestart();

  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Launch Your Next Project" })
    .click();

  await po.sendPrompt("[dump] make it smaller");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("select component next.js", async ({ po }) => {
  await po.setUp();

  await po.navigation.goToHubAndSelectTemplate("Next.js Template");
  await po.chatActions.selectChatMode("build");
  await po.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();

  // Wait for the preview iframe to be visible before interacting
  // Next.js apps take longer to compile and start the dev server
  await po.previewPanel.expectPreviewIframeIsVisible();

  // Wait for the heading to be visible in the iframe before interacting
  // This ensures the Next.js page has fully loaded
  const heading = po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Blank page" });
  await expect(heading).toBeVisible({ timeout: Timeout.EXTRA_LONG });

  // Click pick element button to enter component selection mode
  await po.previewPanel.clickPreviewPickElement();

  // Click the heading to select it as a component
  await heading.click();

  // Wait for the selected component display to appear after clicking the component
  // Use toPass() for retry logic since component selection may take time to register
  await expect(async () => {
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible();
  }).toPass({ timeout: Timeout.MEDIUM });

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.sendPrompt("[dump] make it smaller");
  await po.previewPanel.snapshotPreview();

  await po.snapshotServerDump("all-messages");
});
