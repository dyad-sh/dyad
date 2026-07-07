import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { readSettings, writeSettings } from "@/main/settings";

type TestNotificationConstructor = typeof Notification & {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
};

const originalNotificationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "Notification",
);

function installGrantedNotification() {
  const TestNotification =
    function TestNotification() {} as unknown as TestNotificationConstructor;
  TestNotification.permission = "granted";
  TestNotification.requestPermission = async () => "granted";
  Object.defineProperty(window, "Notification", {
    value: TestNotification,
    configurable: true,
  });
}

function restoreNotification() {
  if (originalNotificationDescriptor) {
    Object.defineProperty(
      window,
      "Notification",
      originalNotificationDescriptor,
    );
  } else {
    delete (window as { Notification?: unknown }).Notification;
  }
}

describe("notification banner (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
    restoreNotification();
    writeSettings({
      enableChatEventNotifications: false,
      skipNotificationBanner: false,
    });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("dismisses permanently when skipped", async () => {
    writeSettings({
      enableChatEventNotifications: false,
      skipNotificationBanner: false,
    });
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const banner = await screen.findByTestId("notification-tip-banner");
    expect(banner.textContent).toContain("Get notified about chat events.");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(screen.queryByTestId("notification-tip-banner")).toBeNull(),
    );
    await waitFor(() =>
      expect(readSettings().skipNotificationBanner).toBe(true),
    );
  });

  it("enables chat event notifications and hides the banner", async () => {
    installGrantedNotification();
    writeSettings({
      enableChatEventNotifications: false,
      skipNotificationBanner: false,
    });
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await screen.findByTestId("notification-tip-banner");
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(screen.queryByTestId("notification-tip-banner")).toBeNull(),
    );
    await waitFor(() =>
      expect(readSettings().enableChatEventNotifications).toBe(true),
    );
  });

  it("does not render when chat event notifications are already enabled", async () => {
    writeSettings({
      enableChatEventNotifications: true,
      skipNotificationBanner: false,
    });
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await waitFor(() =>
      expect(screen.queryByTestId("notification-tip-banner")).toBeNull(),
    );
  });
});
