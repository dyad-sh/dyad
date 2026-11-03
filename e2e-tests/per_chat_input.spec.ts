import { PageObject, test, Timeout } from "./helpers/test_helper";
import { expect, test as baseTest, type TestInfo } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import type { ElectronApplication } from "playwright";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
import { launchElectronApp, terminateElectronApp } from "./helpers/fixtures";

async function launchDyadWithProfile({
  userDataDir,
  fakeLlmPort,
  testInfo,
}: {
  userDataDir: string;
  fakeLlmPort: number;
  testInfo: TestInfo;
}) {
  const electronApp = await launchElectronApp({
    userDataDir,
    fakeLlmPort,
    parallelIndex: testInfo.parallelIndex,
  });
  const page = await electronApp.firstWindow();
  const po = new PageObject(electronApp, page, {
    userDataDir,
    fakeLlmPort,
    testInfo,
  });
  await page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enablePnpmMinimumReleaseAgeWarning: false,
      hidePnpmMinimumReleaseAgeWarning: true,
    });
  });
  return { electronApp, po };
}

test("chat input is preserved when switching between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1: send a message so it becomes a real chat
  await po.sendPrompt("[dump] first chat setup");
  await po.chatActions.waitForChatCompletion();

  // Type some text in Chat 1's input without sending
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("unsent text in chat one");
  await expect(chatInput).toContainText("unsent text in chat one");

  // Create Chat 2
  await po.chatActions.clickNewChat();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] second chat setup");
  await po.chatActions.waitForChatCompletion();

  // Type different text in Chat 2
  await chatInput.fill("unsent text in chat two");
  await expect(chatInput).toContainText("unsent text in chat two");

  // Switch to Chat 1 via the inactive tab
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab.locator("button").first().click();

  // Chat 1 should still have its unsent text
  await expect(chatInput).toContainText("unsent text in chat one", {
    timeout: Timeout.MEDIUM,
  });

  // Switch back to Chat 2 (now the inactive tab)
  const inactiveTab2 = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab2.locator("button").first().click();

  // Chat 2 should still have its unsent text
  await expect(chatInput).toContainText("unsent text in chat two", {
    timeout: Timeout.MEDIUM,
  });
});

test("new chat starts with empty input", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1: type something
  await po.sendPrompt("[dump] initial message");
  await po.chatActions.waitForChatCompletion();
  const chatInput = po.chatActions.getChatInput();
  await chatInput.fill("some draft text");
  await expect(chatInput).toContainText("some draft text");

  // Create a new chat
  await po.chatActions.clickNewChat();

  // New chat input should be empty
  await expect(chatInput).toBeVisible({ timeout: Timeout.SHORT });
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text?.trim()).toBe("");
  }).toPass({ timeout: Timeout.SHORT });
});

test("closing a chat tab clears its stored input", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1
  await po.sendPrompt("[dump] chat one message");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] chat two message");
  await po.chatActions.waitForChatCompletion();

  // Type in Chat 2
  await chatInput.fill("draft in chat two");
  await expect(chatInput).toContainText("draft in chat two");

  // Close the active tab (Chat 2) using the close button on the active tab
  const activeTabContainer = po.page
    .locator("div[draggable]")
    .filter({ has: po.page.locator('button[aria-current="page"]') });
  await activeTabContainer.getByLabel(/^Close tab:/).click();

  // Should now be on Chat 1 — input should not contain Chat 2's text
  await expect(chatInput).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(po.page.getByText("chat one message")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text?.trim() ?? "").not.toContain("draft in chat two");
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("input preserved when switching back and forth multiple times", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.chatActions.getChatInput();

  // Chat 1
  await po.sendPrompt("[dump] chat alpha");
  await po.chatActions.waitForChatCompletion();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("draft-alpha");
  await expect(chatInput).toContainText("draft-alpha");

  // Chat 2
  await po.chatActions.clickNewChat();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] chat beta");
  await po.chatActions.waitForChatCompletion();
  await chatInput.fill("draft-beta");
  await expect(chatInput).toContainText("draft-beta");

  // We're on Chat 2. Switch to Chat 1 (inactive tab).
  const getInactiveTab = () =>
    po.page
      .locator("div[draggable]")
      .filter({ hasNot: po.page.locator('button[aria-current="page"]') });

  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-alpha", {
    timeout: Timeout.MEDIUM,
  });

  // Switch back to Chat 2
  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-beta", {
    timeout: Timeout.MEDIUM,
  });

  // Switch to Chat 1 again — still preserved after multiple switches
  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-alpha", {
    timeout: Timeout.MEDIUM,
  });
});

// The composer map is renderer-local, so only persistence can carry an unsent
// draft across a full app restart. This launches the real Electron app twice on
// the same user data directory, mirroring the queued-message restart test.
baseTest("unsent draft survives an app restart", async ({}, testInfo) => {
  baseTest.skip(
    process.platform === "win32",
    "Manual Electron restarts can hang on Windows in this E2E environment.",
  );
  baseTest.setTimeout(120_000);

  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  const userDataDir = path.join(
    os.tmpdir(),
    `dyad-e2e-chat-draft-${testInfo.parallelIndex}-${Date.now()}`,
  );
  const draft = "unsent draft that must survive a restart";
  let activeApp: ElectronApplication | undefined;

  try {
    const firstSession = await launchDyadWithProfile({
      userDataDir,
      fakeLlmPort,
      testInfo,
    });
    activeApp = firstSession.electronApp;
    await firstSession.po.setUp({ autoApprove: true });
    await firstSession.po.sendPrompt("[dump] draft restart setup");
    await firstSession.po.chatActions.waitForChatCompletion();

    const firstInput = firstSession.po.chatActions.getChatInput();
    await expect(firstInput).toBeVisible();
    await firstInput.fill(draft);
    await expect(firstInput).toContainText(draft);

    await terminateElectronApp(firstSession.electronApp);
    activeApp = undefined;

    const secondSession = await launchDyadWithProfile({
      userDataDir,
      fakeLlmPort,
      testInfo,
    });
    activeApp = secondSession.electronApp;
    await secondSession.po.navigation.goToChatTab();
    await expect(secondSession.po.chatActions.getChatInput()).toContainText(
      draft,
      { timeout: Timeout.LONG },
    );
  } finally {
    if (activeApp) await terminateElectronApp(activeApp);
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  }
});
