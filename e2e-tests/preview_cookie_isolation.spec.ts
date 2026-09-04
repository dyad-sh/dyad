import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

const COOKIE_NAME = "dyad-preview-isolation";

test("local app previews isolate and retain browser cookies", async ({
  po,
}, testInfo) => {
  testInfo.setTimeout(Timeout.EXTRA_LONG * 2 + 120_000);
  await po.setUp({ autoApprove: true });

  const appA = "minimal";
  const appB = "minimal-with-dyad";

  const preview = () => po.previewPanel.getPreviewIframeElement();
  const waitForPreview = async () => {
    await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
    await expect(preview().contentFrame().locator("body")).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
  };
  const previewUrl = async () => {
    const src = await preview().getAttribute("src");
    if (!src) throw new Error("Preview iframe has no URL");
    return new URL(src);
  };
  const setCookie = async (value: string) => {
    await preview()
      .contentFrame()
      .locator("body")
      .evaluate(
        (_body, input) => {
          document.cookie = `${input.name}=${input.value}; Path=/; Secure; SameSite=None`;
        },
        { name: COOKIE_NAME, value },
      );
  };
  const readCookie = async () =>
    preview()
      .contentFrame()
      .locator("body")
      .evaluate((_body, name) => {
        const prefix = `${name}=`;
        return (
          document.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith(prefix))
            ?.slice(prefix.length) ?? null
        );
      }, COOKIE_NAME);
  const switchToApp = async (appName: string) => {
    await po.appManagement.clickAppListItem({ appName });
    await po.appManagement.clickOpenInChatButton();
    await waitForPreview();
  };
  const expectCookie = async (value: string | null) => {
    await expect(async () => expect(await readCookie()).toBe(value)).toPass({
      timeout: Timeout.MEDIUM,
    });
  };

  await po.importApp(appA);
  await waitForPreview();
  const appAUrl = await previewUrl();
  expect(appAUrl.hostname).toMatch(/^app-\d+\.localhost$/);
  await setCookie("app-a");
  await expectCookie("app-a");

  await po.navigation.goToAppsTab();
  await po.page.getByRole("button", { name: "New App" }).click();
  await po.importApp(appB);
  await waitForPreview();
  const appBUrl = await previewUrl();
  expect(appBUrl.hostname).toMatch(/^app-\d+\.localhost$/);
  expect(appBUrl.hostname).not.toBe(appAUrl.hostname);
  expect(appBUrl.port).not.toBe(appAUrl.port);
  await setCookie("app-b");
  await expectCookie("app-b");

  for (let i = 0; i < 2; i++) {
    await switchToApp(appA);
    await expectCookie("app-a");
    await switchToApp(appB);
    await expectCookie("app-b");
  }

  await switchToApp(appA);
  await po.previewPanel.clickPreviewRefresh();
  await waitForPreview();
  await expectCookie("app-a");

  await switchToApp(appB);
  await po.previewPanel.clickPreviewRefresh();
  await waitForPreview();
  await expectCookie("app-b");

  await switchToApp(appA);
  await po.previewPanel.clickClearPreviewData();
  await waitForPreview();
  await expectCookie(null);

  await switchToApp(appB);
  await expectCookie("app-b");
});
