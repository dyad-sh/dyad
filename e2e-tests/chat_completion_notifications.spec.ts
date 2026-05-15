import { expect, type Page } from "@playwright/test";
import { test, testWithConfig } from "./helpers/test_helper";
import { Timeout } from "./helpers/constants";

/**
 * E2E tests for native notifications. We stub window.Notification and validate
 * behavior under two triggers: app hidden and different-chat view.
 */

// Type definitions for page objects
interface ChatActionsPageObject {
  clickNewChat(): Promise<void>;
  sendPrompt(
    text: string,
    options?: { skipWaitForCompletion?: boolean },
  ): Promise<void>;
  waitForChatCompletion(options?: { timeout?: number }): Promise<void>;
}

const testWithNotificationsEnabled = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    const fs = await import("fs");
    const path = await import("path");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableChatEventNotifications: true }, null, 2),
    );
  },
});

async function enableNotifications(po: {
  navigation: any;
  settings: any;
}): Promise<void> {
  await po.navigation.goToSettingsTab();
  await po.settings.enableChatEventNotifications();
  await po.navigation.goToChatTab();
}

async function simulateAppHidden(po: { page: Page }): Promise<void> {
  await po.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(document, "hasFocus", {
      value: () => false,
      configurable: true,
    });
  });
}

async function triggerHidden(po: { page: Page }): Promise<void> {
  await simulateAppHidden(po);
}

async function triggerDifferentChat(
  po: { chatActions: ChatActionsPageObject; page: Page },
  currentChatId: number,
): Promise<number> {
  return switchToDifferentChat(po, currentChatId);
}

async function expectNavigatedToChat(
  po: { page: Page },
  chatId: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const url = po.page.url();
        return Number(url.match(/\?id=(\d+)/)?.[1]);
      },
      { timeout: Timeout.MEDIUM },
    )
    .toBe(chatId);
}

function getChatIdFromUrl(po: { page: Page }): number {
  return Number(po.page.url().match(/\?id=(\d+)/)?.[1]);
}

async function createChat(po: {
  chatActions: ChatActionsPageObject;
  page: Page;
}): Promise<number> {
  await po.chatActions.clickNewChat();
  const chatId = getChatIdFromUrl(po);
  expect(chatId).toBeTruthy();
  return chatId;
}

async function switchToDifferentChat(
  po: { chatActions: ChatActionsPageObject; page: Page },
  currentChatId: number,
): Promise<number> {
  const activeId = getChatIdFromUrl(po);
  if (activeId !== currentChatId) return activeId;
  await po.chatActions.clickNewChat();
  const newId = getChatIdFromUrl(po);
  expect(newId).toBeTruthy();
  expect(newId).not.toBe(currentChatId);
  return newId;
}

// Completion (app hidden): tag, title/body, non-sticky
testWithNotificationsEnabled(
  "chat completion notification when app hidden",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Wait for the initial stream triggered by importing the app to finish
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await enableNotifications(po);

    // Create a fresh chat for the notification test
    const chatId = await createChat(po);

    // Inject notifications AFTER page is fully loaded
    await po.browserNotifications.injectFakeNotifications();

    await po.chatActions.sendPrompt("hello", { skipWaitForCompletion: true });
    await triggerHidden(po);

    const notification =
      await po.browserNotifications.waitForNotificationWithTag(
        `dyad-chat-complete-${chatId}`,
      );

    expect(notification.title).toBe("minimal");
    expect(notification.body).toContain("Chat response completed");
    expect(notification.requireInteraction).toBeFalsy();
    expect(notification.closed).toBe(false);
  },
);

// Completion (different chat): tag, title/body, non-sticky
testWithNotificationsEnabled(
  "chat completion notification when viewing different chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await po.browserNotifications.injectFakeNotifications();

    await po.chatActions.sendPrompt("hello", { skipWaitForCompletion: true });
    await triggerDifferentChat(po, chatId);

    const notification =
      await po.browserNotifications.waitForNotificationWithTag(
        `dyad-chat-complete-${chatId}`,
      );

    expect(notification.title).toBe("minimal");
    expect(notification.body).toContain("Chat response completed");
    expect(notification.requireInteraction).toBeFalsy();
    expect(notification.closed).toBe(false);
  },
);

// Completion auto-close on focus (app hidden)
testWithNotificationsEnabled(
  "notification auto-closes when user focuses chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Wait for the initial stream triggered by importing the app to finish
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await enableNotifications(po);

    // Create a fresh chat for the notification test
    const chatId = await createChat(po);

    await po.browserNotifications.injectFakeNotifications();

    await po.chatActions.sendPrompt("hello", { skipWaitForCompletion: true });
    await triggerHidden(po);

    const tag = `dyad-chat-complete-${chatId}`;
    let notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.closed).toBe(false);

    // Simulate window focus (which triggers handleFocus in useNotificationHandler)
    await po.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Wait for notification to auto-close
    await expect
      .poll(
        async () => {
          const n =
            await po.browserNotifications.waitForNotificationWithTag(tag);
          return n.closed;
        },
        { timeout: Timeout.MEDIUM },
      )
      .toBe(true);
  },
);

// Completion click navigates back to chat (different chat)
testWithNotificationsEnabled(
  "notification click navigates to the chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Wait for the initial stream triggered by importing the app to finish
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await enableNotifications(po);

    // Create a fresh chat for the notification test
    const initialChatId = await createChat(po);

    await po.browserNotifications.injectFakeNotifications();

    await po.chatActions.sendPrompt("test", { skipWaitForCompletion: true });
    await triggerDifferentChat(po, initialChatId);

    const tag = `dyad-chat-complete-${initialChatId}`;
    await po.browserNotifications.waitForNotificationWithTag(tag);

    // Click notification to navigate back
    await po.browserNotifications.clickNotificationWithTag(tag);

    await expectNavigatedToChat(po, initialChatId);
  },
);

// Completion dedupe by tag (app hidden)
testWithNotificationsEnabled(
  "duplicate notification tags close previous notification",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Wait for the initial stream triggered by importing the app to finish
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await enableNotifications(po);

    // Create a fresh chat for the notification test
    const chatId = await createChat(po);

    await po.browserNotifications.injectFakeNotifications();
    const tag = `dyad-chat-complete-${chatId}`;

    // Send first message
    await po.chatActions.sendPrompt("first", { skipWaitForCompletion: true });
    await triggerHidden(po);

    await po.browserNotifications.waitForNotificationWithTag(tag);
    let notifications = await po.browserNotifications.getCreatedNotifications();
    expect(notifications.filter((n) => n.tag === tag)).toHaveLength(1);

    // We are already on the correct chat, and the previous stream is complete
    // because the notification was triggered. We can just send the second message.
    // Send second message - should create new notification with same tag
    await po.chatActions.sendPrompt("second", { skipWaitForCompletion: true });
    await triggerHidden(po);

    await po.browserNotifications.waitForNotificationWithTag(tag);

    // Check that we have 2 notifications with the tag
    // (the new one should have closed the old one)
    notifications = await po.browserNotifications.getCreatedNotifications();
    const tagNotifications = notifications.filter((n) => n.tag === tag);
    expect(tagNotifications.length).toBeGreaterThanOrEqual(1);

    // Latest one should be open
    const latest = tagNotifications[tagNotifications.length - 1];
    expect(latest.closed).toBe(false);
  },
);

// Verifies no notifications are created when the feature is disabled.
test("notification not created when notifications disabled", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.browserNotifications.injectFakeNotifications();

  // Notifications should be disabled by default
  const notifications = await po.browserNotifications.getCreatedNotifications();
  expect(notifications).toHaveLength(0);

  await po.chatActions.sendPrompt("hello");
  await po.chatActions.waitForChatCompletion();

  // Still no notifications
  const notificationsAfter =
    await po.browserNotifications.getCreatedNotifications();
  expect(notificationsAfter).toHaveLength(0);
});

// Completion permission denied shows toast (app hidden)
testWithNotificationsEnabled(
  "notification permission denied shows fallback warning",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Wait for the initial stream triggered by importing the app to finish
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

    await enableNotifications(po);

    // Create a fresh chat for the notification test
    const _chatId = await createChat(po);

    await po.browserNotifications.injectFakeNotifications();
    await po.browserNotifications.setPermission("denied");

    await po.chatActions.sendPrompt("hello", { skipWaitForCompletion: true });
    await triggerHidden(po);

    // Should show fallback toast instead of notification
    const notifications =
      await po.browserNotifications.getCreatedNotifications();
    expect(notifications).toHaveLength(0);

    // Check for warning toast
    await po.toastNotifications.waitForToastWithText(
      "Enable notifications for Dyad",
    );
  },
);

// Agent consent (app hidden): sticky notification
testWithNotificationsEnabled(
  "agent consent notification when app hidden",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerHidden(po);
    await po.browserNotifications.injectFakeNotifications();
    // Simulate Agent Consent IPC Event from Main process
    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("agent-tool:consent-request", {
          requestId: "test-request",
          chatId,
          toolName: "test_tool",
        });
      },
      { chatId },
    );

    const tag = `dyad-agent-consent-${chatId}-test_tool`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.requireInteraction).toBe(true);
  },
);

// Agent consent (different chat): sticky notification
testWithNotificationsEnabled(
  "agent consent notification when viewing different chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("agent-tool:consent-request", {
          requestId: "test-request",
          chatId,
          toolName: "test_tool",
        });
      },
      { chatId },
    );

    const tag = `dyad-agent-consent-${chatId}-test_tool`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.requireInteraction).toBe(true);
  },
);

// Agent consent click navigates back to chat (different chat)
testWithNotificationsEnabled(
  "agent consent notification click navigates to chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("agent-tool:consent-request", {
          requestId: "test-request",
          chatId,
          toolName: "test_tool",
        });
      },
      { chatId },
    );

    const tag = `dyad-agent-consent-${chatId}-test_tool`;
    await po.browserNotifications.waitForNotificationWithTag(tag);

    await po.browserNotifications.clickNotificationWithTag(tag);
    await expectNavigatedToChat(po, chatId);
  },
);

// MCP consent (app hidden): sticky notification with tool info
testWithNotificationsEnabled(
  "mcp consent notification when app hidden",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerHidden(po);
    await po.browserNotifications.injectFakeNotifications();
    // Simulate MCP Consent IPC Event from Main process
    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("mcp:tool-consent-request", {
          requestId: "mcp-request",
          serverId: 1,
          chatId,
          toolName: "mcp_tool",
          serverName: "Test Server",
        });
      },
      { chatId },
    );

    const tag = `dyad-mcp-consent-${chatId}-mcp_tool`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.body).toContain("mcp_tool");
    expect(notification.requireInteraction).toBe(true);
  },
);

// MCP consent (different chat): sticky notification with tool info
testWithNotificationsEnabled(
  "mcp consent notification when viewing different chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("mcp:tool-consent-request", {
          requestId: "mcp-request",
          serverId: 1,
          chatId,
          toolName: "mcp_tool",
          serverName: "Test Server",
        });
      },
      { chatId },
    );

    const tag = `dyad-mcp-consent-${chatId}-mcp_tool`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.body).toContain("mcp_tool");
    expect(notification.requireInteraction).toBe(true);
  },
);

// MCP consent click navigates back to chat (different chat)
testWithNotificationsEnabled(
  "mcp consent notification click navigates to chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("mcp:tool-consent-request", {
          requestId: "mcp-request",
          serverId: 1,
          chatId,
          toolName: "mcp_tool",
          serverName: "Test Server",
        });
      },
      { chatId },
    );

    const tag = `dyad-mcp-consent-${chatId}-mcp_tool`;
    await po.browserNotifications.waitForNotificationWithTag(tag);

    await po.browserNotifications.clickNotificationWithTag(tag);
    await expectNavigatedToChat(po, chatId);
  },
);

// Planning questionnaire (app hidden): tagged sticky notification
testWithNotificationsEnabled(
  "planning questionnaire notification when app hidden",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerHidden(po);
    await po.browserNotifications.injectFakeNotifications();
    // Simulate Questionnaire Event from Main process
    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("plan:questionnaire", {
          chatId,
          requestId: "plan-request",
          questions: [
            {
              id: "q1",
              type: "text",
              question: "What is your favorite color?",
            },
          ],
        });
      },
      { chatId },
    );

    const tag = `dyad-plan-questionnaire-${chatId}-Planning Questions`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.body).toContain("Planning Questions");
    expect(notification.requireInteraction).toBe(true);
  },
);

// Planning questionnaire (different chat): tagged sticky notification
testWithNotificationsEnabled(
  "planning questionnaire notification when viewing different chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("plan:questionnaire", {
          chatId,
          requestId: "plan-request",
          questions: [
            {
              id: "q1",
              type: "text",
              question: "What is your favorite color?",
            },
          ],
        });
      },
      { chatId },
    );

    const tag = `dyad-plan-questionnaire-${chatId}-Planning Questions`;
    const notification =
      await po.browserNotifications.waitForNotificationWithTag(tag);
    expect(notification.body).toContain("Planning Questions");
    expect(notification.requireInteraction).toBe(true);
  },
);

// Planning questionnaire click navigates back to chat (different chat)
testWithNotificationsEnabled(
  "planning questionnaire notification click navigates to chat",
  async ({ po, electronApp }) => {
    await po.setUp({ autoApprove: false });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await enableNotifications(po);

    const chatId = await createChat(po);
    await triggerDifferentChat(po, chatId);
    await po.browserNotifications.injectFakeNotifications();

    await electronApp.evaluate(
      ({ BrowserWindow }, { chatId }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send("plan:questionnaire", {
          chatId,
          requestId: "plan-request",
          questions: [
            {
              id: "q1",
              type: "text",
              question: "What is your favorite color?",
            },
          ],
        });
      },
      { chatId },
    );

    const tag = `dyad-plan-questionnaire-${chatId}-Planning Questions`;
    await po.browserNotifications.waitForNotificationWithTag(tag);

    await po.browserNotifications.clickNotificationWithTag(tag);
    await expectNavigatedToChat(po, chatId);
  },
);
