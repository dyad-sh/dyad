import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("select component", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.chatActions.sendPrompt("[dump] make it smaller");
  await po.previewPanel.snapshotPreview();
  await expect(
    po.previewPanel.getSelectedComponentsDisplay(),
  ).not.toBeVisible();

  await po.snapshotServerDump("all-messages");

  // Send one more prompt to make sure it's a normal message.
  await po.chatActions.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("select multiple components", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("tc=basic");
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
    .getByText("Made with Dyad")
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.chatActions.sendPrompt("[dump] make both smaller");
  await po.previewPanel.snapshotPreview();
  await expect(
    po.previewPanel.getSelectedComponentsDisplay(),
  ).not.toBeVisible();

  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("deselect component", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("tc=basic");
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
  await po.chatActions.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows(
  "deselect individual component from multiple",
  async ({ po }) => {
    await po.setUp();
    await po.chatActions.sendPrompt("tc=basic");
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
      .getByText("Made with Dyad")
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
  await po.appManagement.importApp("select-component");
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

  await po.chatActions.sendPrompt("[dump] make it smaller");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("select component next.js", async ({ po }) => {
  await po.setUp();

  await po.navigation.goToHubAndSelectTemplate("Next.js Template");
  await po.chatActions.selectChatMode("build");
  await po.chatActions.sendPrompt("tc=basic");
  await po.previewPanel.clickTogglePreviewPanel();
  await po.previewPanel.clickPreviewPickElement();

  await po.previewPanel
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Blank page" })
    .click();

  await po.previewPanel.snapshotPreview();
  await po.previewPanel.snapshotSelectedComponentsDisplay();

  await po.chatActions.sendPrompt("[dump] make it smaller");
  await po.previewPanel.snapshotPreview();

  await po.snapshotServerDump("all-messages");
});
