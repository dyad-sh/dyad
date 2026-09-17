import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/test_helper";
import path from "node:path";
import type { ElectronApplication } from "playwright";
import type { PageObject } from "./helpers/page-objects";

async function metrics(scroller: Locator) {
  return scroller.evaluate((element) => ({
    top: element.scrollTop,
    height: element.scrollHeight,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
}

async function startVirtualizedStream(
  po: PageObject,
  electronApp: ElectronApplication,
) {
  await po.setUp();
  await po.importApp("minimal");
  await po.chatActions.selectChatMode("ask");
  // A renderer reload retains the isolated test profile but exercises the real
  // production Virtuoso branch, not MessagesList's test-mode plain list.
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      isTestMode: false,
    });
  });
  const appPath = await electronApp.evaluate(({ app }) => app.getAppPath());
  await electronApp.evaluate(
    async ({ BrowserWindow }, indexPath) => {
      try {
        await BrowserWindow.getAllWindows()[0].loadFile(indexPath);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("(-3)"))
          throw error;
      }
    },
    path.join(appPath, ".vite/renderer/main_window/index.html"),
  );
  await po.sendPrompt("[scroll-bursts]", { skipWaitForCompletion: true });
  const scroller = po.page.locator('[data-virtuoso-scroller="true"]');
  await expect(scroller).toBeVisible();
  const cancel = po.page.getByRole("button", { name: "Cancel generation" });
  await expect(cancel).toBeVisible();
  await expect
    .poll(async () => (await metrics(scroller)).height)
    .toBeGreaterThan(3000);
  return { scroller, cancel };
}

test("virtualized chat follows bursts, respects reading history, and resumes", async ({
  po,
  electronApp,
}) => {
  const { scroller, cancel } = await startVirtualizedStream(po, electronApp);
  // Assert while streaming, not only after the completion callback can rescue it.
  await expect
    .poll(async () => (await metrics(scroller)).gap, { timeout: 2000 })
    .toBeLessThan(5);
  await expect(cancel).toBeVisible();

  await scroller.hover();
  await po.page.mouse.wheel(0, -900);
  await expect
    .poll(async () => (await metrics(scroller)).gap)
    .toBeGreaterThan(500);
  const reading = await metrics(scroller);
  await expect
    .poll(async () => (await metrics(scroller)).height)
    .toBeGreaterThan(reading.height + 1000);
  expect(Math.abs((await metrics(scroller)).top - reading.top)).toBeLessThan(5);

  await po.page
    .locator("button")
    .filter({ has: po.page.locator("svg.lucide-arrow-down") })
    .click();
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  await expect(cancel).toBeVisible();
  const following = await metrics(scroller);
  await expect
    .poll(async () => (await metrics(scroller)).height)
    .toBeGreaterThan(following.height + 1000);
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);

  await po.chatActions.waitForChatCompletion();
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  // Late reflow after completion must retain follow intent as well.
  await po.page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
});

test("virtualized chat preserves keyboard scroll-away through completion", async ({
  po,
  electronApp,
}) => {
  const { scroller, cancel } = await startVirtualizedStream(po, electronApp);
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  await scroller.focus();
  await po.page.keyboard.press("PageUp");
  await expect
    .poll(async () => (await metrics(scroller)).gap)
    .toBeGreaterThan(200);
  await expect(cancel).toBeVisible();
  // Native PageUp may animate; wait for its scroll position to settle before
  // recording the history anchor, while the content continues growing.
  await scroller.evaluate(async (element) => {
    await new Promise<void>((resolve) => {
      let last = element.scrollTop;
      let stableFrames = 0;
      const tick = () => {
        stableFrames = element.scrollTop === last ? stableFrames + 1 : 0;
        last = element.scrollTop;
        if (stableFrames >= 10) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  const reading = await metrics(scroller);
  await po.chatActions.waitForChatCompletion();
  const finished = await metrics(scroller);
  expect(finished.height).toBeGreaterThan(reading.height + 1000);
  expect(Math.abs(finished.top - reading.top)).toBeLessThan(5);

  const chatId = new URL(po.page.url()).searchParams.get("id");
  await po.chatActions.clickNewChat();
  await po.chatActions.selectChatMode("ask");
  await po.sendPrompt("[increment]");
  await po.page.getByTestId(`chat-tab-${chatId}`).click();
  await expect
    .poll(async () => Math.abs((await metrics(scroller)).top - reading.top))
    .toBeLessThan(5);
  await expect(
    po.page.getByRole("button", { name: "Scroll to bottom", exact: true }),
  ).toBeVisible();
  const viewport = await po.page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await po.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 80,
  });
  await expect
    .poll(async () => Math.abs((await metrics(scroller)).top - reading.top))
    .toBeLessThan(5);
  await po.page
    .getByRole("button", { name: "Scroll to bottom", exact: true })
    .click();
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
});
