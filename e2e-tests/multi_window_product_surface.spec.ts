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

test("moves a chat tab to another window only after destination adoption", async ({
  electronApp,
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToSettingsTab();
  await po.page
    .getByRole("switch", { name: "Enable multiple windows" })
    .click();
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await expect(po.page).toHaveURL(/chat/, { timeout: Timeout.MEDIUM });

  const chatId = Number(new URL(po.page.url()).searchParams.get("id"));
  const appName = await po.appManagement.getCurrentAppName();
  if (!appName) throw new Error("Imported app name was not available");
  expect(chatId).toBeGreaterThan(0);

  await po.navigation.goToAppsTab();
  const secondWindowPromise = electronApp.waitForEvent("window");
  const appItem = po.page.getByTestId(`app-list-item-${appName}`);
  await appItem.click({ button: "right" });
  await po.page.getByRole("menuitem", { name: "Open in New Window" }).click();
  const destination = await secondWindowPromise;
  await destination.waitForLoadState("domcontentloaded");
  await expect(destination).toHaveURL(/app-details/, {
    timeout: Timeout.MEDIUM,
  });

  await po.navigation.goToChatTab();
  const sourceTab = po.page.getByTestId(`chat-tab-${chatId}`);
  await expect(sourceTab).toBeVisible({ timeout: Timeout.MEDIUM });

  const sourceInput = po.chatActions.getChatInput();
  await sourceInput.click();
  await sourceInput.pressSequentially("transfer this unfinished draft");
  await expect(sourceInput).toContainText("transfer this unfinished draft");

  const dragPayload = await sourceTab.evaluate((tab) => {
    const dataTransfer = new DataTransfer();
    tab.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    return dataTransfer.getData("application/x-dyad-chat-tab-transfer");
  });
  expect(dragPayload).not.toBe("");

  await destination
    .getByTestId("chat-tab-drop-zone")
    .evaluate((dropZone, payload) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("application/x-dyad-chat-tab-transfer", payload);
      dropZone.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
    }, dragPayload);

  await expect(destination.getByTestId(`chat-tab-${chatId}`)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(
    destination.locator(
      '[data-testid="chat-input-container"]:visible [data-lexical-editor="true"]',
    ),
  ).toContainText("transfer this unfinished draft", {
    timeout: Timeout.MEDIUM,
  });
  await expect(sourceTab).toHaveCount(0, { timeout: Timeout.MEDIUM });

  await po.page.close();
  await expect(
    destination.locator(
      '[data-testid="chat-input-container"]:visible [data-lexical-editor="true"]',
    ),
  ).toContainText("transfer this unfinished draft");
  await expect
    .poll(() => electronApp.windows().length, { timeout: Timeout.MEDIUM })
    .toBe(1);
});
