import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("subscription model usage UX", async ({ po, electronApp }) => {
  await po.setUpDyadPro();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("codex-subscription:status");
    ipcMain.handle("codex-subscription:status", () => ({
      connected: true,
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
  });
  // Refocus causes the shared account query to refresh without reloading an SPA file route.
  await po.page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: /Subscription.*Open submenu/ })
    .hover();
  await expect(
    po.page.getByRole("menuitem", { name: "Disconnect ChatGPT" }),
  ).toBeVisible({ timeout: 40000 });
  await expect(po.page.getByText("5-hour", { exact: true })).toBeVisible();
  await expect(po.page.getByText("Weekly", { exact: true })).toBeVisible();
  await expect(
    po.page.getByText("Uses up to 1.5 Pro credits / 1M tokens", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("menuitem", { name: /^Pro credits/ }),
  ).toHaveCount(0);
  await expect(po.page.getByRole("menuitem", { name: /^API key/ })).toHaveCount(
    0,
  );
  await po.page.keyboard.press("Escape");
  await po.page.keyboard.press("Escape");
  await po.page.getByTestId("model-picker").click();
  await po.page
    .getByRole("menuitem", { name: /^All models(?:\s+All models)?$/i })
    .first()
    .click();
  const eligible = po.page
    .getByRole("menuitem", { name: /GPT 5\.2.*ChatGPT sub/ })
    .first();
  await expect(eligible).toBeVisible();
  await eligible.getByText("ChatGPT sub", { exact: true }).hover();
  await expect(
    po.page.getByText("Using this model will use your ChatGPT subscription", {
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
  await po.page.screenshot({ path: ".claude/tmp/subscription-connected.png" });
});
