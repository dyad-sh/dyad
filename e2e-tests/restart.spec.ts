import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("restart app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  await po.clickRestart();
  await expect(po.locateLoadingAppPreview()).toBeVisible();
  await expect(po.locateLoadingAppPreview()).not.toBeVisible({
    timeout: Timeout.LONG,
  });

  await po.snapshotPreview();
});
