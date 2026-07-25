import { expect } from "@playwright/test";
import path from "node:path";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

const address = (appId: number) => ({
  protocolVersion: 1,
  machineId: "app_run",
  encodedKey: { appId },
});

async function subscribe(page: import("@playwright/test").Page, appId: number) {
  return page.evaluate(
    async (input) =>
      (window as any).electron.ipcRenderer.invoke(
        "distributed-machine:subscribe",
        input,
      ),
    address(appId),
  );
}

testSkipIfWindows(
  "main-hosted app run survives renderer reload, a second window, and quit",
  async ({ electronApp, po }, testInfo) => {
    testInfo.setTimeout(Timeout.EXTRA_LONG);
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    const appName = await po.appManagement.getCurrentAppName();
    let appId: number | undefined;
    await expect(async () => {
      const { apps } = await po.page.evaluate(async () =>
        (window as any).electron.ipcRenderer.invoke("list-apps"),
      );
      appId = apps.find((app: { name: string }) => app.name === appName)?.id;
      expect(appId).toEqual(expect.any(Number));
    }).toPass({ timeout: Timeout.MEDIUM });

    const firstSnapshot = await subscribe(po.page, appId!);
    await expect(async () => {
      const snapshot = await subscribe(po.page, appId!);
      expect(snapshot.encodedState.phase).toBe("ready");
    }).toPass({ timeout: Timeout.EXTRA_LONG });
    const appPath = await electronApp.evaluate(({ app }) => app.getAppPath());
    const rendererIndexPath = path.join(
      appPath,
      ".vite/renderer/main_window/index.html",
    );
    const preloadPath = path.join(appPath, ".vite/build/preload.js");
    const secondWindow = electronApp.waitForEvent("window");
    const secondWindowId = await electronApp.evaluate(
      async ({ BrowserWindow }, paths) => {
        const second = new BrowserWindow({
          width: 960,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: paths.preload,
          },
        });
        await second.loadFile(paths.renderer);
        return second.id;
      },
      { renderer: rendererIndexPath, preload: preloadPath },
    );
    const secondPage = await secondWindow;
    await secondPage.waitForLoadState("domcontentloaded");

    const secondSnapshot = await subscribe(secondPage, appId!);
    expect(secondSnapshot.actorInstanceId).toBe(firstSnapshot.actorInstanceId);

    await electronApp.evaluate(
      async ({ BrowserWindow }, input) => {
        try {
          await BrowserWindow.fromId(input.windowId)?.loadFile(input.renderer);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("(-3)")) {
            throw error;
          }
        }
      },
      { windowId: secondWindowId, renderer: rendererIndexPath },
    );
    await secondPage.waitForLoadState("domcontentloaded");
    const afterReload = await subscribe(secondPage, appId!);
    expect(afterReload.actorInstanceId).toBe(firstSnapshot.actorInstanceId);
    expect(afterReload.revision).toBeGreaterThanOrEqual(firstSnapshot.revision);

    const processExited = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await electronApp.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    await expect(processExited).resolves.toBeUndefined();
  },
);
