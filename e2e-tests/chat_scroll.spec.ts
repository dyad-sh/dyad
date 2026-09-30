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

async function waitForScrollToSettle(scroller: Locator) {
  // Wheel/PageUp movement and Virtuoso measurements can continue after the
  // first scroll event. Record the reading anchor only after they settle.
  await scroller.evaluate(async (element) => {
    await new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 5000;
      let last = element.scrollTop;
      let stableFrames = 0;
      const tick = () => {
        stableFrames = element.scrollTop === last ? stableFrames + 1 : 0;
        last = element.scrollTop;
        if (stableFrames >= 10) resolve();
        else if (performance.now() > deadline)
          reject(new Error("Scroll did not settle"));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
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
  await po.page.evaluate(() => {
    sessionStorage.setItem("dyad:e2e:virtualized-chat", "true");
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
  await waitForScrollToSettle(scroller);
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
  await expect(scroller).toBeFocused();
  await po.page.keyboard.press("PageUp");
  await expect
    .poll(async () => (await metrics(scroller)).gap)
    .toBeGreaterThan(200);
  await expect(cancel).toBeVisible();
  // Native PageUp may animate; wait for its scroll position to settle before
  // recording the history anchor, while the content continues growing.
  await waitForScrollToSettle(scroller);
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
  // Native downward scrolling should reattach even when the gesture stops
  // slightly short of the bottom; this does not use the jump button.
  await scroller.hover();
  await po.page.mouse.wheel(0, (await metrics(scroller)).gap - 60);
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);

  // Enlarging the viewport can reach the bottom without another user gesture.
  await po.page.mouse.wheel(0, -120);
  await expect
    .poll(async () => (await metrics(scroller)).gap)
    .toBeGreaterThan(80);
  await expect(
    po.page.getByRole("button", { name: "Scroll to bottom", exact: true }),
  ).toBeVisible();
  await po.page.setViewportSize({
    width: viewport.width,
    height: viewport.height + 100,
  });
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  await expect(
    po.page.getByRole("button", { name: "Scroll to bottom", exact: true }),
  ).toBeHidden();
});

test("existing long virtualized chat opens at the bottom without flashing its first message", async ({
  po,
  electronApp,
}) => {
  test.setTimeout(180_000);
  await po.setUp();
  await po.importApp("minimal");
  await po.chatActions.selectChatMode("ask");
  for (let index = 0; index < 24; index++) {
    await po.sendPrompt(`[increment] history message ${index}`);
  }
  const chatId = new URL(po.page.url()).searchParams.get("id");
  await po.page.evaluate(() => {
    sessionStorage.setItem("dyad:e2e:virtualized-chat", "true");
  });
  // Observe every rendering frame, not just the eventual settled position.
  await po.page.addInitScript((targetChatId) => {
    const samples: Array<{ gap: number; firstVisible: boolean }> = [];
    Object.assign(window, { chatOpeningSamples: samples });
    const sample = () => {
      if (new URL(location.href).searchParams.get("id") !== targetChatId)
        return;
      const scroller = document.querySelector<HTMLElement>(
        '[data-virtuoso-scroller="true"]',
      );
      if (scroller && scroller.clientHeight > 0) {
        const first = scroller.querySelector<HTMLElement>(
          '[data-item-index="0"]',
        );
        const bounds = scroller.getBoundingClientRect();
        const rect = first?.getBoundingClientRect();
        samples.push({
          gap:
            scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
          firstVisible:
            !!rect &&
            first!.textContent!.includes("[increment] history message 0") &&
            first!.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }) &&
            rect.bottom > bounds.top &&
            rect.top < bounds.bottom,
        });
      }
    };
    const afterFrame = () => {
      // Read after all animation-frame callbacks, including the controller's
      // positioning callback; a pre-paint sample can report an unseen top frame.
      setTimeout(sample, 0);
      requestAnimationFrame(afterFrame);
    };
    requestAnimationFrame(afterFrame);
  }, chatId);
  const appPath = await electronApp.evaluate(({ app }) => app.getAppPath());
  await electronApp.evaluate(
    async ({ BrowserWindow }, indexPath) => {
      await BrowserWindow.getAllWindows()[0].loadFile(indexPath);
    },
    path.join(appPath, ".vite/renderer/main_window/index.html"),
  );
  const scroller = po.page.locator('[data-virtuoso-scroller="true"]');
  await expect(scroller).toBeVisible();
  await expect
    .poll(async () => (await metrics(scroller)).height)
    .toBeGreaterThan(3000);
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  await waitForScrollToSettle(scroller);
  const openingSamples = await po.page.evaluate(
    () =>
      (
        window as unknown as {
          chatOpeningSamples: Array<{ gap: number; firstVisible: boolean }>;
        }
      ).chatOpeningSamples,
  );
  expect(openingSamples.length).toBeGreaterThan(0);
  expect(openingSamples.some((sample) => sample.firstVisible)).toBe(false);

  await po.chatActions.clickNewChat();
  await po.chatActions.selectChatMode("ask");
  await po.sendPrompt("[increment]");
  const otherChatId = new URL(po.page.url()).searchParams.get("id");
  await po.page.evaluate(() => {
    (
      window as unknown as { chatOpeningSamples: unknown[] }
    ).chatOpeningSamples.length = 0;
  });
  await po.page.getByTestId(`chat-tab-${chatId}`).click();
  await expect
    .poll(async () => (await metrics(scroller)).height)
    .toBeGreaterThan(3000);
  await expect.poll(async () => (await metrics(scroller)).gap).toBeLessThan(5);
  await waitForScrollToSettle(scroller);
  await expect(scroller).toBeVisible();
  const restoredSamples = await po.page.evaluate(
    () =>
      (
        window as unknown as {
          chatOpeningSamples: Array<{ firstVisible: boolean }>;
        }
      ).chatOpeningSamples,
  );
  expect(restoredSamples.length).toBeGreaterThan(0);
  expect(restoredSamples.some((sample) => sample.firstVisible)).toBe(false);

  // A deliberately saved top-of-history position must also become visible.
  await scroller.focus();
  await po.page.keyboard.press("Home");
  await expect.poll(async () => (await metrics(scroller)).top).toBeLessThan(5);
  await waitForScrollToSettle(scroller);
  await po.page.getByTestId(`chat-tab-${otherChatId}`).click();
  await po.page.getByTestId(`chat-tab-${chatId}`).click();
  await expect(scroller).toBeVisible();
  await expect.poll(async () => (await metrics(scroller)).top).toBeLessThan(5);
  await expect(
    scroller.getByText("[increment] history message 0", { exact: true }),
  ).toBeVisible();
});
