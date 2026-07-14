import {
  PageObject,
  test,
  testSkipIfWindows,
  Timeout,
} from "./helpers/test_helper";
import {
  expect,
  test as baseTest,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import os from "os";
import path from "path";
import treeKill from "tree-kill";
import { _electron as electron, type ElectronApplication } from "playwright";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";

async function queueMessage(page: Page, chatInput: Locator, message: string) {
  await expect(async () => {
    await chatInput.click();
    await chatInput.fill(message);
    expect(await chatInput.textContent()).toContain(message);
  }).toPass({ timeout: Timeout.MEDIUM });

  await chatInput.press("Enter");
  await expect(page.locator("li", { hasText: message })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
}

function configureE2eEnv(fakeLlmPort: number, parallelIndex: number) {
  process.env.FAKE_LLM_PORT = String(fakeLlmPort);
  process.env.DYAD_E2E_PORT_BLOCK_INDEX = String(parallelIndex);
  process.env.OLLAMA_HOST = `http://localhost:${fakeLlmPort}/ollama`;
  process.env.LM_STUDIO_BASE_URL_FOR_TESTING = `http://localhost:${fakeLlmPort}/lmstudio`;
  process.env.DYAD_ENGINE_URL = `http://localhost:${fakeLlmPort}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `http://localhost:${fakeLlmPort}/gateway/v1`;
  process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
  process.env.DYAD_TEST_PNPM_VERSION = "11.1.2";
  process.env.E2E_TEST_BUILD = "true";
  process.env.OPENAI_API_KEY = "sk-test";
}

function definedProcessEnv() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

async function launchDyadWithProfile({
  userDataDir,
  fakeLlmPort,
  testInfo,
}: {
  userDataDir: string;
  fakeLlmPort: number;
  testInfo: TestInfo;
}) {
  configureE2eEnv(fakeLlmPort, testInfo.parallelIndex);

  const appInfo = eph.parseElectronApp(eph.findLatestBuild());
  const electronApp = await electron.launch({
    args: [appInfo.main, "--enable-logging", `--user-data-dir=${userDataDir}`],
    executablePath: appInfo.executable,
    env: definedProcessEnv(),
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

async function closeDyad(electronApp: ElectronApplication) {
  const childProcess = electronApp.process();
  const pid = childProcess.pid;

  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
  ]);

  if (!pid || childProcess.exitCode !== null || childProcess.signalCode) {
    return;
  }

  await new Promise<void>((resolve) => {
    treeKill(pid, "SIGKILL", () => resolve());
  });
}

async function expectPersistedQueuedPrompts(
  page: Page,
  expectedPrompts: string[],
) {
  await expect
    .poll(
      async () => {
        const persistedQueue = (await page.evaluate(async () => {
          return (window as any).electron.ipcRenderer.invoke(
            "get-queued-prompts",
          );
        })) as Record<string, Array<{ prompt: string }>>;

        return Object.values(persistedQueue)
          .flat()
          .map((item) => item.prompt)
          .sort();
      },
      { timeout: Timeout.MEDIUM },
    )
    .toEqual([...expectedPrompts].sort());
}

test.describe("queued messages", () => {
  let chatInput: Locator;

  test.beforeEach(async ({ po }) => {
    await po.setUp({ autoApprove: true });
    chatInput = po.chatActions.getChatInput();
  });

  test("gets added and sent after stream completes", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // While streaming, send another message - this should be queued
    await queueMessage(po.page, chatInput, "tc=2");

    // Verify the queued message indicator is visible
    // The UI shows "{count} Queued" followed by "- {status}"
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).toBeVisible();

    // Wait for the first stream to complete
    await po.chatActions.waitForChatCompletion();

    // Verify the queued message indicator is gone (message is now being sent)
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).not.toBeVisible();

    // Wait for the queued message to also complete
    await po.chatActions.waitForChatCompletion();

    // Verify both messages were sent by checking the message list
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("tc=2")).toBeVisible();
  });

  test("can be reordered, deleted, and edited", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // Queue 3 messages while streaming
    await queueMessage(po.page, chatInput, "tc=first");
    await queueMessage(po.page, chatInput, "tc=second");
    await queueMessage(po.page, chatInput, "tc=third");

    // Verify 3 messages are queued
    await expect(po.page.getByText("3 Queued")).toBeVisible();

    // Reorder: move "tc=third" up so it swaps with "tc=second"
    const thirdRow = po.page.locator("li", { hasText: "tc=third" });
    await thirdRow.hover();
    await thirdRow.getByTitle("Move up").click();

    // Delete: remove "tc=second" (now the last item after the reorder)
    const secondRow = po.page.locator("li", { hasText: "tc=second" });
    await secondRow.hover();
    await secondRow.getByTitle("Delete").click();

    // Verify count dropped to 2
    await expect(po.page.getByText("2 Queued")).toBeVisible();

    // Edit: click edit on "tc=first", modify the text, and submit
    const firstRow = po.page.locator("li", { hasText: "tc=first" });
    await firstRow.hover();
    await firstRow.getByTitle("Edit").click();

    // The input should now contain the message text
    await expect(chatInput).toContainText("tc=first");

    // Clear and type the new text
    await chatInput.click();
    await po.page.keyboard.press("ControlOrMeta+a");
    await chatInput.pressSequentially("tc=first-edited");
    await chatInput.press("Enter");

    // Verify the edited text appears in the queue
    await expect(
      po.page.locator("li", { hasText: "tc=first-edited" }),
    ).toBeVisible();

    // Wait for the initial stream to finish, then the queued messages to send
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.waitForChatCompletion();

    // Verify the final messages were sent in correct order:
    // "tc=first-edited" first, then "tc=third" (which was moved up past "tc=second")
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=first-edited")).toBeVisible();
    await expect(messagesList.getByText("tc=third")).toBeVisible();
    // "tc=second" was deleted, so it should NOT appear
    await expect(messagesList.getByText("tc=second")).not.toBeVisible();
  });

  test("fires queued message while on another page", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });

    // Wait for chat input to appear (indicates we're in chat view and streaming)
    await expect(chatInput).toBeVisible();

    // While streaming, queue a second message
    await queueMessage(po.page, chatInput, "tc=2");

    // Verify the queued message indicator is visible
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).toBeVisible();

    // Navigate away from the chat page while streaming + queue are active
    await po.sleep(1_000);
    await po.navigation.goToAppsTab();

    // Wait for the in-progress indicator to disappear, meaning both the
    // first stream and the queued message have completed in the background
    await expect(
      po.page.locator('[aria-label="Chat in progress"]'),
    ).not.toBeVisible({ timeout: 30_000 });

    // Navigate back to the chat to verify both messages were sent
    const chatTab = po.page
      .locator("button")
      .filter({ hasText: /Chat/ })
      .first();
    await chatTab.click();

    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
    await expect(messagesList.getByText("tc=2")).toBeVisible();
  });
});

testSkipIfWindows(
  "canceling queued message edit clears restored components",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    const chatInput = po.chatActions.getChatInput();

    // Build an app so we have a preview with selectable components
    await po.sendPrompt("tc=basic");
    await po.previewPanel.clickTogglePreviewPanel();

    // Start a slow streaming response so the setup below finishes while queuing is still active
    await po.sendPrompt("tc=1 [sleep=long]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    // While streaming, select a component and queue a message with it
    await po.previewPanel.clickPreviewPickElement();
    await po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByRole("heading", { name: "Welcome to Your Blank App" })
      .click();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    await queueMessage(po.page, chatInput, "queued with component");
    await expect(po.page.getByText(/\d+ Queued/)).toBeVisible();

    // Edit the queued message — components should be restored
    const queuedRow = po.page.locator("li", {
      hasText: "queued with component",
    });
    await queuedRow.hover();
    await queuedRow.getByTitle("Edit").click();
    await expect(po.previewPanel.getSelectedComponentsDisplay()).toBeVisible({
      timeout: Timeout.SHORT,
    });

    // Cancel the edit — components should be cleared
    await po.page.getByText("Cancel", { exact: true }).click();
    await expect(
      po.previewPanel.getSelectedComponentsDisplay(),
    ).not.toBeVisible();

    // Input should be empty after cancel
    await expect(chatInput).toBeEmpty();

    // Wait for the in-flight chat and the queued message to finish before ending the test
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.EXTRA_LONG });
    await po.chatActions.waitForChatCompletion();
  },
);

baseTest("persists queued prompts across app restart", async ({}, testInfo) => {
  baseTest.skip(
    process.platform === "win32",
    "Manual Electron restarts can hang on Windows in this E2E environment.",
  );
  baseTest.setTimeout(120_000);

  const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
  const userDataDir = path.join(
    os.tmpdir(),
    `dyad-e2e-queued-prompts-${testInfo.parallelIndex}-${Date.now()}`,
  );
  const queuedPrompts = ["persisted queued one", "persisted queued two"];
  let activeApp: ElectronApplication | undefined;

  try {
    const session1 = await launchDyadWithProfile({
      userDataDir,
      fakeLlmPort,
      testInfo,
    });
    activeApp = session1.electronApp;
    const po = session1.po;

    await po.setUp({ autoApprove: true });
    const chatInput = po.chatActions.getChatInput();

    await po.sendPrompt("tc=1 [sleep=long]", {
      skipWaitForCompletion: true,
    });
    await expect(chatInput).toBeVisible();

    for (const prompt of queuedPrompts) {
      await queueMessage(po.page, chatInput, prompt);
    }

    await expect(po.page.getByText("2 Queued")).toBeVisible();
    await expectPersistedQueuedPrompts(po.page, queuedPrompts);

    await closeDyad(activeApp);
    activeApp = undefined;

    const session2 = await launchDyadWithProfile({
      userDataDir,
      fakeLlmPort,
      testInfo,
    });
    activeApp = session2.electronApp;
    const relaunchedPo = session2.po;

    await relaunchedPo.navigation.goToChatTab();
    const queueHeader = relaunchedPo.page.getByTestId("queue-header");
    await expect(queueHeader).toContainText("2 Queued", {
      timeout: Timeout.MEDIUM,
    });
    await expect(queueHeader).toContainText("Paused");
    await expect(
      relaunchedPo.page.getByRole("button", { name: "Resume queue" }),
    ).toBeVisible();

    for (const prompt of queuedPrompts) {
      await expect(
        relaunchedPo.page.locator("li", { hasText: prompt }),
      ).toBeVisible();
    }
  } finally {
    if (activeApp) {
      await closeDyad(activeApp);
    }
  }
});
