import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  testWithConfig,
  Timeout,
  type ElectronConfig,
} from "./helpers/test_helper";

const electronConfig: ElectronConfig = {
  preLaunchHook: async ({ userDataDir }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "window-sessions.json"),
      "{malformed-session-state",
      "utf8",
    );
  },
};

const test = testWithConfig(electronConfig);

test("falls back to one usable restorable window when session state is corrupt", async ({
  electronApp,
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await expect
    .poll(() => electronApp.windows().length, { timeout: Timeout.MEDIUM })
    .toBe(1);

  await po.importApp("minimal");
  const appName = await po.appManagement.getCurrentAppName();
  if (!appName) throw new Error("Imported app name was not available");
  await po.navigation.goToAppsTab();
  await po.page.getByTestId(`app-list-item-${appName}`).click();
  await expect(po.page).toHaveURL(/app-details/, {
    timeout: Timeout.MEDIUM,
  });

  const appPath = await electronApp.evaluate(({ app }) => app.getAppPath());
  const rendererIndexPath = path.join(
    appPath,
    ".vite/renderer/main_window/index.html",
  );
  await electronApp.evaluate(async ({ BrowserWindow }, rendererPath) => {
    try {
      await BrowserWindow.getAllWindows()[0].loadFile(rendererPath);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(-3)")) {
        throw error;
      }
    }
  }, rendererIndexPath);

  await po.page.waitForLoadState("domcontentloaded");
  await expect(po.page).toHaveURL(/app-details/, {
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText(appName, { exact: true }).first()).toBeVisible(
    { timeout: Timeout.MEDIUM },
  );
  await expect
    .poll(() => electronApp.windows().length, { timeout: Timeout.MEDIUM })
    .toBe(1);
});
