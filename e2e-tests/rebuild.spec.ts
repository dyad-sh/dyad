import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test("rebuild app", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("hi");
  await po.snapshotPreview();

  const currentAppPath = await po.getCurrentAppPath();
  const testPath = path.join(currentAppPath, "node_modules", "test.txt");
  fs.writeFileSync(testPath, "test");

  await po.clickRebuild();
  await expect(po.locateLoadingAppPreview()).toBeVisible();
  await expect(po.locateLoadingAppPreview()).not.toBeVisible({
    timeout: 15_000,
  });

  // Check that the file is removed with the rebuild
  expect(fs.existsSync(testPath)).toBe(false);
  await po.snapshotPreview();
});
