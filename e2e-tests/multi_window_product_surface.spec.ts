import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import path from "node:path";

test("opens an app in a second product window and survives closing the initiator", async ({
  electronApp,
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToSettingsTab();
  const multiWindowSwitch = po.page.getByRole("switch", {
    name: "Enable multiple windows",
  });
  await multiWindowSwitch.click();
  await expect(multiWindowSwitch).toBeChecked();
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  const appName = await po.appManagement.getCurrentAppName();
  if (!appName) throw new Error("Imported app name was not available");
  await po.navigation.goToAppsTab();

  const secondWindowPromise = electronApp.waitForEvent("window");
  const appItem = po.page.getByTestId(`app-list-item-${appName}`);
  await appItem.click({ button: "right" });
  await po.page.getByRole("menuitem", { name: "Open in New Window" }).click();

  const secondWindow = await secondWindowPromise;
  await secondWindow.waitForLoadState("load");
  await expect(secondWindow).toHaveURL(/app-details/, {
    timeout: Timeout.MEDIUM,
  });
  await expect(
    secondWindow.getByText(appName, { exact: true }).first(),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  await expect
    .poll(
      () =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      { timeout: Timeout.MEDIUM },
    )
    .toBe(2);

  await po.page.close();

  await expect(
    secondWindow.getByText(appName, { exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(() => electronApp.windows().length, { timeout: Timeout.MEDIUM })
    .toBe(1);

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
  await secondWindow.waitForLoadState("domcontentloaded");
  await expect(secondWindow).toHaveURL(/app-details/, {
    timeout: Timeout.MEDIUM,
  });
  await expect(
    secondWindow.getByText(appName, { exact: true }).first(),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});
