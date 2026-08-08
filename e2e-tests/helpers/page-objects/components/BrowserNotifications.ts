/**
 * Page object for browser (OS) notifications.
 * Since we can't reliably test the actual OS notification surface in an automated way, this page object injects a fake Notification implementation into the app that captures created notifications. This allows us to assert on notification creation, content, and simulated interactions without relying on the OS.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export interface FakeNotificationRecord {
  title: string;
  body?: string;
  tag?: string;
  requireInteraction?: boolean;
  closed: boolean;
}

export class BrowserNotifications {
  constructor(public page: Page) {}

  /**
   * Inject a fake window.Notification global that captures created notifications.
   * Must be called before triggering notification-creating flows.
   */
  async injectFakeNotifications() {
    await this.page.evaluate(() => {
      const created: any[] = [];

      class FakeNotification {
        static permission: NotificationPermission = "granted";
        static requestPermission: () => Promise<NotificationPermission> =
          async () => "granted";

        title: string;
        options: NotificationOptions;
        onclick: (() => void) | null = null;
        onclose: (() => void) | null = null;
        closed = false;

        constructor(title: string, options: NotificationOptions = {}) {
          this.title = title;
          this.options = options;
          created.push(this);
        }

        close() {
          this.closed = true;
          this.onclose?.();
        }
      }

      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: FakeNotification,
      });

      (window as any).__createdNotifications = created;
    });
  }

  /**
   * Set the fake notification permission to a specific value.
   * Useful for testing permission denial/default flows.
   */
  async setPermission(permission: NotificationPermission) {
    await this.page.evaluate((perm) => {
      const Notification = window.Notification as any;
      if (Notification) {
        Notification.permission = perm;
        if (perm === "denied") {
          Notification.requestPermission = async () => "denied";
        } else if (perm === "default") {
          Notification.requestPermission = async () => "granted";
        }
      }
    }, permission);
  }

  async getCreatedNotifications(): Promise<FakeNotificationRecord[]> {
    return await this.page.evaluate(() => {
      const notifications = (window as any).__createdNotifications ?? [];
      return notifications.map((n: any) => ({
        title: n.title,
        body: n.options?.body,
        tag: n.options?.tag,
        requireInteraction: n.options?.requireInteraction,
        closed: n.closed,
      }));
    });
  }

  async waitForNotificationWithTag(
    tag: string,
    timeout = Timeout.MEDIUM,
  ): Promise<FakeNotificationRecord> {
    await expect
      .poll(
        async () => {
          const notifications = await this.getCreatedNotifications();
          return notifications.find((n) => n.tag === tag);
        },
        { timeout },
      )
      .toBeTruthy();

    const notifications = await this.getCreatedNotifications();
    return notifications.find((n) => n.tag === tag)!;
  }

  async waitForNotificationWithText(
    title: string,
    body?: string,
    timeout = Timeout.MEDIUM,
  ): Promise<FakeNotificationRecord> {
    await expect
      .poll(
        async () => {
          const notifications = await this.getCreatedNotifications();
          return notifications.find(
            (n) => n.title.includes(title) && (!body || n.body?.includes(body)),
          );
        },
        { timeout },
      )
      .toBeTruthy();

    const notifications = await this.getCreatedNotifications();
    return notifications.find(
      (n) => n.title.includes(title) && (!body || n.body?.includes(body)),
    )!;
  }

  async clickNotificationWithTag(tag: string) {
    await this.page.evaluate((targetTag) => {
      const notifications = (window as any).__createdNotifications ?? [];
      const notification = notifications.find(
        (n: any) => n.options?.tag === targetTag,
      );
      if (notification?.onclick) {
        notification.onclick.call(notification);
      }
    }, tag);
  }

  async closeNotificationWithTag(tag: string) {
    await this.page.evaluate((targetTag) => {
      const notifications = (window as any).__createdNotifications ?? [];
      const notification = notifications.find(
        (n: any) => n.options?.tag === targetTag,
      );
      if (notification) {
        notification.close();
      }
    }, tag);
  }

  async getActiveNotificationCount(): Promise<number> {
    return await this.page.evaluate(() => {
      const notifications = (window as any).__createdNotifications ?? [];
      return notifications.filter((n: any) => !n.closed).length;
    });
  }

  async assertNotificationClosed(tag: string) {
    const notification = await this.waitForNotificationWithTag(tag);
    expect(notification.closed).toBe(true);
  }

  async assertNotificationOpen(tag: string) {
    const notification = await this.waitForNotificationWithTag(tag);
    expect(notification.closed).toBe(false);
  }

  async clearNotifications() {
    await this.page.evaluate(() => {
      (window as any).__createdNotifications = [];
    });
  }
}
