import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("tabs appear after navigating between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("[dump] build a todo app");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("[dump] build a weather app");
  await po.chatActions.waitForChatCompletion();

  // At least one tab should be visible (tabs render once there are recent chats).
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("clicking a tab switches to that chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1 - send a unique message
  await po.sendPrompt("First chat unique message alpha");
  await po.chatActions.waitForChatCompletion();

  // Chat 2 - send a different unique message
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Second chat unique message beta");
  await po.chatActions.waitForChatCompletion();

  // Wait for at least 2 tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: Timeout.MEDIUM });

  // We're on chat 2 (active). Find and click the inactive tab to switch to chat 1.
  // Each tab is a div[draggable] with a title button + close button. The active tab's title button has aria-current="page".
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab.locator("button").first().click();

  // After clicking, chat 1's message should be visible
  await expect(
    po.page.getByText("First chat unique message alpha"),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});

test("closing a tab removes it and selects adjacent tab", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Chat 1
  await po.sendPrompt("First chat message gamma");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Second chat message delta");
  await po.chatActions.waitForChatCompletion();

  // Chat 3 (currently active)
  await po.chatActions.clickNewChat();
  await po.sendPrompt("Third chat message epsilon");
  await po.chatActions.waitForChatCompletion();

  // Wait for tabs to appear
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  const initialCount = await (async () => {
    let count = 0;
    await expect(async () => {
      count = await closeButtons.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: Timeout.MEDIUM });
    return count;
  })();

  // Close the first tab.
  await po.page
    .getByLabel(/^Close tab:/)
    .first()
    .click();

  // After closing, tab count should decrease.
  await expect(async () => {
    const newCount = await closeButtons.count();
    expect(newCount).toBe(initialCount - 1);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("tabs are session-scoped and support right-click bulk close actions", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.page.evaluate(async () => {
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) throw new Error("ipcRenderer is not available");

    const apps = await ipcRenderer.invoke("list-apps");
    const appId = apps[0]?.id;
    if (!appId) throw new Error("No app found");

    for (const title of ["Session tab A", "Session tab B", "Session tab C"]) {
      const chatId = await ipcRenderer.invoke("create-chat", appId);
      await ipcRenderer.invoke("update-chat", { chatId, title });
    }
  });

  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(closeButtons).toHaveCount(0);

  await po.page.getByRole("button", { name: /Session tab A/ }).click();
  await po.page.getByRole("button", { name: /Session tab B/ }).click();
  await po.page.getByRole("button", { name: /Session tab C/ }).click();

  await expect(async () => {
    expect(await closeButtons.count()).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  const tabB = po.page.locator("div[draggable]").filter({
    has: po.page.getByText("Session tab B", { exact: true }),
  });
  await tabB.click({ button: "right" });
  await po.page
    .getByRole("menuitem", { name: "Close all tabs to the right" })
    .click();

  await expect(
    po.page.locator("div[draggable]").filter({
      has: po.page.getByText("Session tab C", { exact: true }),
    }),
  ).toHaveCount(0);

  const tabA = po.page.locator("div[draggable]").filter({
    has: po.page.getByText("Session tab A", { exact: true }),
  });
  await tabA.click({ button: "right" });
  await po.page.getByRole("menuitem", { name: "Close other tabs" }).click();

  await expect(tabA).toHaveCount(1);
  await expect(
    po.page.locator("div[draggable]").filter({
      has: po.page.getByText("Session tab B", { exact: true }),
    }),
  ).toHaveCount(0);
  await expect(closeButtons).toHaveCount(1);
});
