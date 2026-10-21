import path from "node:path";
import { expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import { testWithConfigSkipIfWindows, Timeout } from "./helpers/test_helper";

const test = testWithConfigSkipIfWindows({ testTimeout: 180_000 });

const SESSION_COOKIE = "recorder-session";

test("shared localhost previews isolate app sessions and clear them on delete", async ({
  po,
  electronApp,
}) => {
  await po.setUp({ autoApprove: true });
  expect((await po.settings.recordSettings()).enableAppPreviewDomains).not.toBe(
    true,
  );

  // The fake auth cookie as Chromium actually stored it on shared localhost.
  const sessionCookies = async () =>
    (
      await electronApp.evaluate(async ({ session }) =>
        (await session.defaultSession.cookies.get({ domain: "localhost" })).map(
          (cookie) => ({
            name: cookie.name,
            domain: cookie.domain,
            httpOnly: cookie.httpOnly,
          }),
        ),
      )
    )
      .filter((cookie) => cookie.name.endsWith(SESSION_COOKIE))
      .sort((a, b) => a.name.localeCompare(b.name));

  // A session one app left under the shared name before namespacing.
  await electronApp.evaluate(
    ({ session }, name) =>
      session.defaultSession.cookies.set({
        url: "http://localhost/",
        name,
        value: "authenticated",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "no_restriction",
      }),
    SESSION_COOKIE,
  );
  expect(await sessionCookies()).toEqual([
    { name: SESSION_COOKIE, domain: "localhost", httpOnly: true },
  ]);

  const frame = () => po.previewPanel.getPreviewIframeElement().contentFrame();
  // The fixture renders "Signed out" before its session request resolves, so
  // ask the app's session endpoint through the proxy instead.
  const sessionUser = () =>
    frame()
      .locator("body")
      .evaluate(
        async () =>
          (
            await (
              await fetch("/api/auth/get-session", { credentials: "include" })
            ).json()
          )?.user?.id ?? null,
      );
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
    await expect(frame().getByTestId("auth-state")).toHaveText("Signed out");
    const origin = new URL(
      (await po.previewPanel.getPreviewIframeElement().getAttribute("src"))!,
    );
    expect(origin.hostname).toBe("localhost");
    const { apps } = await po.page.evaluate(() =>
      (window as any).electron.ipcRenderer.invoke("list-apps", undefined),
    );
    return apps.find((app: { name: string }) => app.name === name).id as number;
  }
  async function signIn() {
    await frame()
      .locator("body")
      .evaluate(() =>
        fetch("/api/auth/sign-in/email", {
          method: "POST",
          credentials: "include",
        }),
      );
    await po.previewPanel.clickPreviewRefresh();
    await expect(frame().getByTestId("auth-state")).toHaveText("Signed in");
  }

  // Even a change before the first app starts must wait for a Dyad restart.
  await po.page.evaluate(() =>
    (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enablePreviewCookieIsolation: false,
    }),
  );

  // Starting the first shared-localhost proxy sweeps the pre-namespace session.
  const appOne = await importRecorder("cookie-app-one");
  expect(await sessionUser()).toBeNull();
  expect(await sessionCookies()).toEqual([]);

  await signIn();
  expect(await sessionCookies()).toEqual([
    {
      name: `dyad-a${appOne}.${SESSION_COOKIE}`,
      domain: "localhost",
      httpOnly: true,
    },
  ]);

  // Chromium must still enforce __Host-'s Path=/ guarantee after namespacing.
  await frame()
    .locator("body")
    .evaluate(async (_body, appId) => {
      await fetch("/api/auth/security-prefix-session", { method: "POST" });
      document.cookie = `__Host-dyad-a${appId}.protected-session=shadow; Path=/api; Secure; SameSite=None`;
    }, appOne);
  expect(
    await electronApp.evaluate(
      async ({ session }, appId) =>
        (await session.defaultSession.cookies.get({ domain: "localhost" }))
          .filter(
            (cookie) =>
              cookie.name === `__Host-dyad-a${appId}.protected-session`,
          )
          .map(({ name, value, path, httpOnly }) => ({
            name,
            value,
            path,
            httpOnly,
          })),
      appOne,
    ),
  ).toEqual([
    {
      name: `__Host-dyad-a${appOne}.protected-session`,
      value: "authenticated",
      path: "/",
      httpOnly: true,
    },
  ]);
  const protectedSession = await frame()
    .locator("body")
    .evaluate(async () =>
      (await fetch("/api/auth/security-prefix-session")).json(),
    );
  expect(protectedSession.cookie).toContain(
    "__Host-protected-session=authenticated",
  );
  expect(protectedSession.cookie).not.toContain("shadow");

  await po.navigation.goToAppsTab();
  if (
    await po.page
      .getByRole("button", { name: "New App", exact: true })
      .isVisible()
  )
    await po.page.getByRole("button", { name: "New App", exact: true }).click();
  const appTwo = await importRecorder("cookie-app-two");
  // Before namespacing, app two received app one's session cookie.
  expect(await sessionUser()).toBeNull();

  await signIn();
  expect(await sessionCookies()).toEqual(
    [appOne, appTwo]
      .map((appId) => ({
        name: `dyad-a${appId}.${SESSION_COOKIE}`,
        domain: "localhost",
        httpOnly: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  await po.appManagement.clickAppListItem({ appName: "cookie-app-one" });
  await po.appManagement.clickOpenInChatButton();
  await po.previewPanel.expectPreviewIframeIsVisible();
  await expect(frame().getByTestId("auth-state")).toHaveText("Signed in");
  expect(await sessionUser()).toBe("test-user");

  // Deleting app one removes only its namespaced session.
  await po.appManagement.clickAppListItem({ appName: "cookie-app-one" });
  await po.appManagement.clickAppDetailsMoreOptions();
  await po.page.getByRole("button", { name: "Delete", exact: true }).click();
  await po.page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete App" })
    .click();
  await expect.poll(sessionCookies, { timeout: Timeout.LONG }).toEqual([
    {
      name: `dyad-a${appTwo}.${SESSION_COOKIE}`,
      domain: "localhost",
      httpOnly: true,
    },
  ]);
});
