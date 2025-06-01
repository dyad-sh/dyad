import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("auto-approve", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");
  await po.snapshotMessages();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.getPreviewIframeElement()).toBeVisible({ timeout: 15_000 });
  await po.snapshotPreview();
});
