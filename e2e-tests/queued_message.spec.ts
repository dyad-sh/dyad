import { PageObject, test, Timeout } from "./helpers/test_helper";
import {
  expect,
  test as baseTest,
  type Locator,
  type Page,
} from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import type { ElectronApplication } from "playwright";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
import {
  launchDyadWithProfile,
  terminateElectronApp,
} from "./helpers/fixtures";

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

async function waitForGeneration(po: PageObject) {
  await expect(
    po.page.getByRole("button", { name: /cancel generation/i }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
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
    await waitForGeneration(po);

    // Wait for chat input to appear now that streaming is active.
    await expect(chatInput).toBeVisible();

    // While streaming, send another message - this should be queued
    await queueMessage(po.page, chatInput, "tc=2");

    // Verify the queued message indicator is visible
    // The UI shows "{count} Queued" followed by "- {status}"
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).toBeVisible();

    // The next generation starts immediately, so the idle state between turns
    // can be too brief to observe. Wait for the queued prompt to be admitted,
    // then wait for the final generation to finish.
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(messagesList.getByText("tc=2", { exact: true })).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
    await expect(
      po.page.getByText(/\d+ Queued.*will send after current response/),
    ).not.toBeVisible();
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.EXTRA_LONG });

    // Verify both messages were sent by checking the message list
    await expect(messagesList.getByText("tc=1 [sleep=medium]")).toBeVisible();
  });

  test("can be reordered, deleted, and edited", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await waitForGeneration(po);

    // Wait for chat input to appear now that streaming is active.
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

    // Verify the final messages were sent in correct order:
    // "tc=first-edited" first, then "tc=third" (which was moved up past "tc=second")
    const messagesList = po.page.locator('[data-testid="messages-list"]');
    await expect(
      messagesList.getByText("tc=first-edited", { exact: true }),
    ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
    await expect(
      messagesList.getByText("tc=third", { exact: true }),
    ).toBeVisible({
      timeout: Timeout.EXTRA_LONG,
    });
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.EXTRA_LONG });
    // "tc=second" was deleted, so it should NOT appear
    await expect(messagesList.getByText("tc=second")).not.toBeVisible();
  });

  test("stops and parks an unpaused queue without an error toast", async ({
    po,
  }) => {
    await po.sendPrompt("tc=1 [sleep=long]", {
      skipWaitForCompletion: true,
    });
    await waitForGeneration(po);
    await expect(chatInput).toBeVisible();

    await queueMessage(po.page, chatInput, "tc=2 [sleep=medium]");
    const queueHeader = po.page.getByTestId("queue-header");
    await expect(queueHeader).toContainText("1 Queued");
    await expect(queueHeader).not.toContainText("Paused");
    await po.toastNotifications.dismissAllToasts();

    await po.page.getByRole("button", { name: /cancel generation/i }).click();

    await expect(queueHeader).toContainText("Paused", {
      timeout: Timeout.MEDIUM,
    });
    await expect(
      po.page.getByRole("button", { name: /cancel generation/i }),
    ).not.toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(queueHeader).toContainText("1 Queued");
    await expect(
      queueHeader.getByText("tc=2 [sleep=medium]", { exact: true }),
    ).toBeVisible();
    await po.toastNotifications.expectNoToast();

    // Cancellation replaces the composer while its acceptance state settles.
    // Use the resilient Send-button path so this submission targets the current
    // editor and resumes the parked queue.
    await po.sendPrompt("tc=3", { skipWaitForCompletion: true });

    await expect(
      po.page.getByRole("button", { name: /cancel generation/i }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(queueHeader).not.toContainText("Paused");
    await expect(queueHeader).toContainText("1 Queued");
    await expect(queueHeader.getByText("tc=3", { exact: true })).toBeVisible();
    await expect(
      po.page
        .locator('[data-testid="messages-list"]')
        .getByText("tc=2 [sleep=medium]", { exact: true }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.toastNotifications.expectNoToast();
  });

  test("fires queued message while on another page", async ({ po }) => {
    // Send a message with a medium sleep to simulate a slow response
    await po.sendPrompt("tc=1 [sleep=medium]", {
      skipWaitForCompletion: true,
    });
    await waitForGeneration(po);

    // Wait for chat input to appear now that streaming is active.
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

test("keeps queued prompts across renderer reload", async ({
  po,
  electronApp,
}) => {
  const queuedPrompts = [
    "renderer reload queued one",
    "renderer reload queued two",
  ];

  await po.setUp({ autoApprove: true });
  const chatInput = po.chatActions.getChatInput();

  await po.sendPrompt("tc=1 [sleep=long]", {
    skipWaitForCompletion: true,
  });
  await waitForGeneration(po);
  await expect(chatInput).toBeVisible();

  for (const prompt of queuedPrompts) {
    await queueMessage(po.page, chatInput, prompt);
  }

  const queueHeader = po.page.getByTestId("queue-header");
  await expect(queueHeader).toContainText("2 Queued");
  await po.page.getByRole("button", { name: "Pause queue" }).click();
  await expect(queueHeader).toContainText("Paused");

  const appPath = await electronApp.evaluate(({ app }) => app.getAppPath());
  const rendererIndexPath = path.join(
    appPath,
    ".vite/renderer/main_window/index.html",
  );
  await electronApp.evaluate(async ({ BrowserWindow }, rendererIndexPath) => {
    const window = BrowserWindow.getAllWindows()[0];
    try {
      await window.loadFile(rendererIndexPath);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(-3)")) {
        throw error;
      }
    }
  }, rendererIndexPath);
  await po.page.waitForLoadState("domcontentloaded");

  await expect(queueHeader).toContainText("2 Queued", {
    timeout: Timeout.EXTRA_LONG,
  });
  await expect(queueHeader).toContainText("Paused");
  await expect(
    po.page.getByRole("button", { name: "Resume queue" }),
  ).toBeVisible();

  for (const prompt of queuedPrompts) {
    await expect(po.page.locator("li", { hasText: prompt })).toBeVisible();
  }
});

baseTest(
  "restores queued prompts paused after app restart",
  async ({}, testInfo) => {
    baseTest.skip(
      process.platform === "win32",
      "Manual Electron restarts can hang on Windows in this E2E environment.",
    );
    baseTest.setTimeout(120_000);

    const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;
    const userDataDir = path.join(
      os.tmpdir(),
      `dyad-e2e-durable-queue-${testInfo.parallelIndex}-${Date.now()}`,
    );
    const queuedPrompts = ["durable queued one", "durable queued two"];
    let activeApp: ElectronApplication | undefined;

    try {
      const firstSession = await launchDyadWithProfile({
        userDataDir,
        fakeLlmPort,
        testInfo,
      });
      activeApp = firstSession.electronApp;
      await firstSession.po.setUp({ autoApprove: true });
      const chatInput = firstSession.po.chatActions.getChatInput();
      await firstSession.po.sendPrompt("tc=1 [sleep=long]", {
        skipWaitForCompletion: true,
      });
      await waitForGeneration(firstSession.po);
      await expect(chatInput).toBeVisible();
      for (const prompt of queuedPrompts) {
        await queueMessage(firstSession.po.page, chatInput, prompt);
      }
      await expect(
        firstSession.po.page.getByTestId("queue-header"),
      ).toContainText("2 Queued");

      await terminateElectronApp(firstSession.electronApp);
      activeApp = undefined;

      const secondSession = await launchDyadWithProfile({
        userDataDir,
        fakeLlmPort,
        testInfo,
      });
      activeApp = secondSession.electronApp;
      await secondSession.po.navigation.goToChatTab();
      const queueHeader = secondSession.po.page.getByTestId("queue-header");
      await expect(queueHeader).toContainText("2 Queued", {
        timeout: Timeout.EXTRA_LONG,
      });
      await expect(queueHeader).toContainText("Paused");
      await expect(
        secondSession.po.page.getByRole("button", { name: "Resume queue" }),
      ).toBeVisible();
      for (const prompt of queuedPrompts) {
        await expect(
          secondSession.po.page.locator("li", { hasText: prompt }),
        ).toBeVisible();
      }
    } finally {
      if (activeApp) await terminateElectronApp(activeApp);
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  },
);
