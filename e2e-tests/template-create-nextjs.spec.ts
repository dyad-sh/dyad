import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const PREVIEW_START_TIMEOUT = process.env.CI ? 300_000 : 100_000;

test("create next.js app", async ({ po }, testInfo) => {
  testInfo.setTimeout(PREVIEW_START_TIMEOUT + 60_000);
  // This test covers template creation and preview startup, not the proposal
  // review flow. Auto-approve keeps the generated edit deterministic while
  // the imported template may still be installing dependencies.
  await po.setUp({ autoApprove: true });
  const beforeSettings = po.settings.recordSettings();
  await po.navigation.goToTemplatesAndSelectTemplate("Next.js Template");
  await po.chatActions.selectChatMode("build");
  po.settings.snapshotSettingsDelta(beforeSettings);

  // Create an app
  await po.sendPrompt("tc=edit-made-with-dyad");

  await po.clickRestart();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.previewPanel.getPreviewIframeElement()).toBeVisible({
    timeout: PREVIEW_START_TIMEOUT,
  });
  await po.previewPanel.snapshotPreview();
});
