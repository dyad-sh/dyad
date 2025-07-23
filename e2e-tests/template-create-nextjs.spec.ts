import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("create next.js app", async ({ po }) => {
  await po.setUp();
  await po.goToHubAndSelectTemplate("Next.js Template");
  await po.snapshotSettings();

  // Create an app
  await po.sendPrompt("tc=edit-made-with-dyad");
  await po.approveProposal();

  await po.clickRestart();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.getPreviewIframeElement()).toBeVisible({ timeout: 100_000 });
  await po.snapshotPreview();
});
