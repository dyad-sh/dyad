import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("select component", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.snapshotPreview();
  await po.snapshotSelectedComponentDisplay();

  await po.sendPrompt("[dump] make it smaller");
  await po.snapshotPreview();
  await expect(po.getSelectedComponentDisplay()).not.toBeVisible();

  await po.snapshotServerDump("all-messages");

  // Send one more prompt to make sure it's a normal message.
  await po.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("deselect component", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Welcome to Your Blank App" })
    .click();

  await po.snapshotPreview();
  await po.snapshotSelectedComponentDisplay();

  // Deselect the component and make sure the state has reverted
  await po.clickDeselectComponent();

  await po.snapshotPreview();
  await expect(po.getSelectedComponentDisplay()).not.toBeVisible();

  // Send one more prompt to make sure it's a normal message.
  await po.sendPrompt("[dump] tc=basic");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("upgrade app to select component", async ({ po }) => {
  await po.setUp();
  await po.importApp("select-component");
  await po.getTitleBarAppNameButton().click();
  await po.clickAppUpgradeButton({ upgradeId: "component-tagger" });
  await po.expectAppUpgradeButtonIsNotVisible({
    upgradeId: "component-tagger",
  });
  await po.snapshotAppFiles({ name: "app-upgraded" });
  await po.clickOpenInChatButton();
  // There should be another version from the upgrade being committed.
  await expect(po.page.getByText("Version 2")).toBeVisible();

  await po.clickPreviewPickElement();

  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Launch Your Next Project" })
    .click();

  await po.sendPrompt("[dump] make it smaller");
  await po.snapshotServerDump("last-message");
});

testSkipIfWindows("select component next.js", async ({ po }) => {
  await po.setUp();

  await po.goToHubAndSelectTemplate("Next.js Template");

  await po.sendPrompt("tc=basic");
  await po.clickTogglePreviewPanel();
  await po.clickPreviewPickElement();

  await po
    .getPreviewIframeElement()
    .contentFrame()
    .getByRole("heading", { name: "Blank page" })
    .click();

  await po.snapshotPreview();
  await po.snapshotSelectedComponentDisplay();

  await po.sendPrompt("[dump] make it smaller");
  await po.snapshotPreview();

  await po.snapshotServerDump("all-messages");
});
