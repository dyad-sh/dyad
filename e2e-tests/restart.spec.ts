import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("restart app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");

  await po.clickRestart();
  await expect(po.locateLoadingAppPreview()).toBeVisible();
  await expect(po.locateLoadingAppPreview()).not.toBeVisible({
    timeout: 15_000,
  });

  await po.snapshotPreview();
});
