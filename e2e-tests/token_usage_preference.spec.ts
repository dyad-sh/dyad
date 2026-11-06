import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
import { launchElectronApp, terminateElectronApp } from "./helpers/fixtures";

test("keeps token usage visibility after restarting Dyad", async ({
  po,
  electronApp,
}, testInfo) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await expect(po.page.getByTestId("chat-input-container")).toBeVisible();
  await expect(po.page.getByTestId("token-bar")).toHaveCount(0);
  await po.page.getByTestId("auxiliary-actions-menu").click();
  await po.page.getByText("Show token usage", { exact: true }).click();
  await expect(po.page.getByTestId("token-bar")).toBeVisible();
  await po.page.screenshot({ path: testInfo.outputPath("enabled.png") });

  const { userDataDir, fakeLlmPort } = po;
  await terminateElectronApp(electronApp);
  const restarted = await launchElectronApp({
    userDataDir,
    fakeLlmPort,
    parallelIndex: testInfo.parallelIndex,
  });
  try {
    const page = await restarted.firstWindow();
    await expect(page.getByTestId("token-bar")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("restarted.png") });
    await page.getByTestId("auxiliary-actions-menu").click();
    await page.getByText("Hide token usage", { exact: true }).click();
    await expect(page.getByTestId("token-bar")).toHaveCount(0);
  } finally {
    await terminateElectronApp(restarted);
  }
});
