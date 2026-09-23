import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import { testWithConfigSkipIfWindows, Timeout } from "./helpers/test_helper";

const test = testWithConfigSkipIfWindows({ testTimeout: 180_000 });

test("app hostnames isolate sessions through restart, HMR, native preview and recording cleanup", async ({
  po,
  electronApp,
}) => {
  await po.setUp({ autoApprove: true });
  async function importRecorder(name: string) {
    await po.page.getByRole("button", { name: "Import App" }).click();
    await eph.stubDialog(electronApp, "showOpenDialog", {
      filePaths: [path.join(__dirname, "fixtures/import-app/recorder")],
    });
    await po.page.getByRole("button", { name: "Select Folder" }).click();
    await po.page
      .getByRole("textbox", { name: "Enter new app name" })
      .fill(name);
    await po.page.getByRole("button", { name: "Import", exact: true }).click();
    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
    await expect(
      po.previewPanel
        .getPreviewIframeElement()
        .contentFrame()
        .getByTestId("auth-state"),
    ).toHaveText("Signed out");
    return new URL(
      (await po.previewPanel.getPreviewIframeElement().getAttribute("src"))!,
    ).origin;
  }
  const frame = () => po.previewPanel.getPreviewIframeElement().contentFrame();
  async function signIn() {
    await frame()
      .locator("body")
      .evaluate(async () => {
        await fetch("/api/auth/sign-in/email", {
          method: "POST",
          credentials: "include",
        });
        localStorage.setItem("session-note", "kept");
      });
    await po.previewPanel.clickPreviewRefresh();
    await expect(frame().getByTestId("auth-state")).toHaveText("Signed in");
  }
  const firstOrigin = await importRecorder("cookie-app-one");
  expect(new URL(firstOrigin).hostname).toMatch(/^app-\d+\.localhost$/);
  await signIn();
  await expect
    .poll(() =>
      frame()
        .locator("body")
        .evaluate(async () =>
          (await navigator.serviceWorker.getRegistrations()).map(
            (registration) => registration.scope,
          ),
        ),
    )
    .toContain(`${firstOrigin}/`);

  // A real dev-server restart retains this app's host-only session.
  const previousProcess = await po.appManagement.getCurrentAppProcessId();
  await po.clickRestart();
  await expect
    .poll(
      async () => {
        const current = await po.appManagement.getCurrentAppProcessId();
        return current !== null && current !== previousProcess;
      },
      { timeout: Timeout.EXTRA_LONG },
    )
    .toBe(true);
  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  await expect(frame().getByTestId("auth-state")).toHaveText("Signed in", {
    timeout: Timeout.LONG,
  });
  expect(
    new URL(
      (await po.previewPanel.getPreviewIframeElement().getAttribute("src"))!,
    ).origin,
  ).toBe(firstOrigin);

  // Hot reload continues using the app hostname and its WebSocket connection.
  const source = path.join(
    await po.appManagement.getCurrentAppPath(),
    "src/App.tsx",
  );
  await writeFile(
    source,
    (await readFile(source, "utf8")).replace(
      "Recorder Test App",
      "Reloaded Cookie App",
    ),
  );
  await expect(
    frame().getByRole("heading", { name: "Reloaded Cookie App" }),
  ).toBeVisible({ timeout: Timeout.LONG });

  // Capture the actual browser-open action without launching an external app.
  await electronApp.evaluate(({ ipcMain }) => {
    (globalThis as any).__previewOpenedUrls = [];
    ipcMain.removeHandler("open-external-url");
    ipcMain.handle("open-external-url", (_event, url: string) => {
      (globalThis as any).__previewOpenedUrls.push(url);
    });
  });
  await po.previewPanel.clickPreviewMoreOptions();
  await po.page.getByTestId("preview-open-browser-menu-item").click();
  await expect
    .poll(() =>
      electronApp.evaluate(() => (globalThis as any).__previewOpenedUrls),
    )
    .toEqual([firstOrigin]);
  await po.previewPanel.clickPreviewMoreOptions();
  await po.page.getByTestId("preview-open-dev-server-menu-item").click();
  await expect
    .poll(() =>
      electronApp.evaluate(() => (globalThis as any).__previewOpenedUrls),
    )
    .toEqual([firstOrigin, expect.stringMatching(/^http:\/\/localhost:\d+/)]);

  await po.navigation.goToAppsTab();
  if (
    await po.page
      .getByRole("button", { name: "New App", exact: true })
      .isVisible()
  )
    await po.page.getByRole("button", { name: "New App", exact: true }).click();
  const secondOrigin = await importRecorder("cookie-app-two");
  expect(new URL(secondOrigin).hostname).not.toBe(
    new URL(firstOrigin).hostname,
  );
  await signIn();
  const cookies = await electronApp.evaluate(async ({ session }) =>
    (
      await session.defaultSession.cookies.get({ name: "recorder-session" })
    ).map((cookie) => ({ domain: cookie.domain, hostOnly: cookie.hostOnly })),
  );
  expect(cookies).toEqual(
    expect.arrayContaining([
      { domain: new URL(firstOrigin).hostname, hostOnly: true },
      { domain: new URL(secondOrigin).hostname, hostOnly: true },
    ]),
  );

  // The native test preview keeps its existing fresh in-memory partition.
  // Exercise navigation and authentication at the app hostname in that session.
  await po.page.evaluate(async (url) => {
    await (window as any).electron.ipcRenderer.invoke("preview-view:show", {
      url,
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    });
  }, secondOrigin);
  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }, origin) => {
        const view = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith(origin));
        return view?.executeJavaScript(
          "document.querySelector('[data-testid=auth-state]')?.textContent",
        );
      }, secondOrigin),
    )
    .toBe("Signed out");
  expect(
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const view = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(origin))!;
      return view.executeJavaScript(
        `(async () => { await fetch("/api/auth/sign-in/email", { method: "POST" }); return (await (await fetch("/api/auth/get-session")).json())?.user?.id; })()`,
      );
    }, secondOrigin),
  ).toBe("test-user");
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("preview-view:hide");
  });

  await po.previewPanel.selectPreviewMode("tests");
  await po.previewPanel.clickEnableTesting();
  await po.previewPanel.selectPreviewMode("preview");
  await po.previewPanel.startRecording();
  await expect(po.page.getByTestId("preview-recording-bar")).toBeVisible({
    timeout: Timeout.LONG,
  });
  await expect(frame().getByTestId("auth-state")).toHaveText("Signed out");
  expect(
    await frame()
      .locator("body")
      .evaluate(() => localStorage.getItem("session-note")),
  ).toBeNull();
  await po.page.getByTestId("preview-recording-cancel-button").click();
  await expect(po.page.getByTestId("preview-recording-bar")).toBeHidden();

  await po.appManagement.clickAppListItem({ appName: "cookie-app-one" });
  await po.appManagement.clickOpenInChatButton();
  await po.previewPanel.expectPreviewIframeIsVisible();
  await expect(frame().getByTestId("auth-state")).toHaveText("Signed in");
  expect(
    await frame()
      .locator("body")
      .evaluate(() => localStorage.getItem("session-note")),
  ).toBe("kept");
});
