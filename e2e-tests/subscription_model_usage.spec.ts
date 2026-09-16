import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("subscription model usage UX", async ({ po, electronApp }, testInfo) => {
  await po.setUpDyadPro();
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler("codex-subscription:status");
    ipcMain.handle("codex-subscription:status", () => ({
      connected: true,
      planType: "plus",
      pending: false,
      models: ["gpt-5.2"],
      limitReached: true,
      windows: [
        {
          usedPercent: 100,
          windowSeconds: 18000,
          resetsAt: Date.now() + 3600000,
        },
        {
          usedPercent: 40,
          windowSeconds: 604800,
          resetsAt: Date.now() + 86400000,
        },
      ],
    }));
    BrowserWindow.getAllWindows()[0].webContents.send("deep-link-received", {
      type: "chatgpt-connected",
    });
  });
  await po.page.getByTestId("model-picker").click();
  const subscriptionMenu = po.page.getByRole("menuitem", {
    name: "Subscription, New, ChatGPT connected. Open submenu.",
  });
  await expect(subscriptionMenu).toBeVisible();
  await subscriptionMenu.hover();
  await expect(
    po.page.getByRole("menuitem", { name: "Disconnect ChatGPT" }),
  ).toBeVisible({ timeout: 40000 });
  await expect(po.page.getByText("5-hour", { exact: true })).toBeVisible();
  await expect(po.page.getByText("Weekly", { exact: true })).toBeVisible();
  await expect(po.page.getByText("Plus", { exact: true })).toBeVisible();
  await expect(
    subscriptionMenu.getByText("New", { exact: true }),
  ).toBeVisible();
  const sideMenu = po.page.locator('[data-slot="dropdown-menu-sub-content"]');
  await expect(async () => {
    const parent = await subscriptionMenu.boundingBox();
    const panel = await sideMenu.boundingBox();
    expect(parent).not.toBeNull();
    expect(panel).not.toBeNull();
    const gap =
      panel!.x >= parent!.x
        ? panel!.x - (parent!.x + parent!.width)
        : parent!.x - (panel!.x + panel!.width);
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThanOrEqual(4);
  }).toPass();
  await expect(
    po.page.getByText("Get up to 5× usage with your ChatGPT subscription.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("menuitem", { name: /^Pro credits/ }),
  ).toHaveCount(0);
  await expect(po.page.getByRole("menuitem", { name: /^API key/ })).toHaveCount(
    0,
  );
  await po.page.screenshot({
    path: testInfo.outputPath("subscription-menu.png"),
  });
  await po.page.keyboard.press("Escape");
  await po.page.keyboard.press("Escape");
  // Neither side has room in this window: show details in the same menu.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(400, 400);
    window.setSize(600, 700);
  });
  await po.page.getByTestId("model-picker").click();
  await subscriptionMenu.click();
  await expect(
    po.page.getByRole("menuitem", { name: "Back to models" }),
  ).toBeVisible();
  await expect(sideMenu).toHaveCount(0);
  await expect(
    po.page.getByRole("menuitem", { name: /^All models/ }),
  ).toHaveCount(0);
  await po.page.getByRole("menuitem", { name: "Back to models" }).click();
  await expect(subscriptionMenu).toBeFocused();
  await po.page.keyboard.press("Escape");
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1400, 900),
  );
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: /^All models(?:\s+All models)?$/i })
    .first()
    .click();
  const eligible = po.page
    .getByRole("menuitem", { name: /GPT 5\.2.*ChatGPT plan/ })
    .first();
  await expect(eligible).toBeVisible();
  await eligible.getByText("ChatGPT plan", { exact: true }).hover();
  await expect(
    po.page.getByText("Uses your connected ChatGPT subscription", {
      exact: true,
    }),
  ).toBeVisible();
  await po.page.keyboard.press("Escape");
  await po.page.keyboard.press("Escape");
  await po.page.getByRole("button", { name: "Pro", exact: true }).click();
  const subscription = po.page.getByRole("button", {
    name: "ChatGPT Subscription",
    exact: true,
  });
  await expect(subscription).toHaveAttribute("aria-pressed", "true");
  await po.page
    .getByRole("button", { name: "Pro credits", exact: true })
    .click();
  await expect(
    po.page.getByRole("button", { name: "Pro credits", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const saved = await po.page.evaluate(async () => {
    const value = await (window as any).electron.ipcRenderer.invoke(
      "get-user-settings",
    );
    return (value.value ?? value).proModelUsage;
  });
  expect(saved).toBe("pro");
  await po.page.keyboard.press("Escape");
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler("codex-subscription:status");
    ipcMain.handle("codex-subscription:status", () => ({
      connected: true,
      pending: false,
      celebrationPending: true,
      models: ["gpt-5.2"],
      windows: [],
      limitReached: false,
    }));
    BrowserWindow.getAllWindows()[0].webContents.send("deep-link-received", {
      type: "chatgpt-connected",
    });
  });
  await expect(
    po.page.getByRole("dialog", { name: "Enjoy your extra Dyad usage!" }),
  ).toBeVisible();
  await expect(
    po.page.getByText(
      "Uses up to 1.5 Dyad Pro credits / 1 million tokens processed.",
      { exact: true },
    ),
  ).toBeVisible();
});
