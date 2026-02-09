import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("auto-approve", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.chatActions.sendPrompt("tc=write-index");
  await po.snapshotMessages();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.previewPanel.getPreviewIframeElement()).toBeVisible({
    timeout: Timeout.LONG,
  });
  await po.previewPanel.snapshotPreview();
});
