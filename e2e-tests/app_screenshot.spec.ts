import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

const SCREENSHOT_FILENAME_REGEX = /^[0-9a-f]{40}\.png$/;

test("captures an app screenshot after the first generated commit", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");
  await po.previewPanel.expectPreviewIframeIsVisible();

  const appPath = await po.appManagement.getCurrentAppPath();
  const screenshotDir = path.join(appPath, ".dyad", "screenshot");

  await expect(async () => {
    const entries = fs.existsSync(screenshotDir)
      ? fs.readdirSync(screenshotDir)
      : [];
    const screenshots = entries.filter((entry) =>
      SCREENSHOT_FILENAME_REGEX.test(entry),
    );
    expect(screenshots.length).toBeGreaterThan(0);
    const size = fs.statSync(path.join(screenshotDir, screenshots[0])).size;
    expect(size).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  await po.appManagement.getTitleBarAppNameButton().click();
  await expect(po.page.getByRole("img", { name: /Preview of/ })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
