import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("captures an app screenshot after the first generated commit", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");
  await po.previewPanel.expectPreviewIframeIsVisible();

  const appPath = await po.appManagement.getCurrentAppPath();
  const screenshotPath = path.join(
    appPath,
    ".dyad",
    "screenshot",
    "screenshot.png",
  );

  await expect(async () => {
    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.statSync(screenshotPath).size).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  await po.appManagement.getTitleBarAppNameButton().click();
  await expect(po.page.getByRole("img", { name: "App preview" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
