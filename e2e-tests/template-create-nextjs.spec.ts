import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("create next.js app", async ({ po }) => {
  await po.setUp();
  // Select Next.js template
  await po.goToHubTab();
  await po.selectTemplate("Next.js Template");
  await po.goToAppsTab();

  // Create an app
  await po.sendPrompt("tc=edit-made-with-dyad");
  await po.approveProposal();

  await po.clickRestart();

  // This can be pretty slow because it's waiting for the app to build.
  await expect(po.getPreviewIframeElement()).toBeVisible({ timeout: 50_000 });
  await po.snapshotPreview();
});
