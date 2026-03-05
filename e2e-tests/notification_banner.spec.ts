import * as path from "path";
import * as fs from "fs";
import { expect } from "@playwright/test";
import { test, testWithConfig } from "./helpers/test_helper";

const testWithNotificationsEnabled = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableChatCompletionNotifications: true }, null, 2),
    );
  },
});

test("notification banner - visible, Enable enables notifications, skip hides permanently", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Banner should be visible since notifications are not enabled
  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Get notified when chat responses finish.",
  );

  // Test skip/dismiss first
  // Record settings before skipping
  const beforeSettings = po.settings.recordSettings();

  // Click dismiss (X) button
  await banner.getByRole("button", { name: "Dismiss" }).click();

  // Banner should be hidden
  await expect(banner).not.toBeVisible();

  // Verify settings were updated with skipNotificationBanner: true
  po.settings.snapshotSettingsDelta(beforeSettings);

  // Navigate away and back to verify banner stays hidden
  await po.navigation.goToSettingsTab();
  await po.navigation.goToChatTab();
  await expect(banner).not.toBeVisible();
});

testWithNotificationsEnabled(
  "notification banner - not shown when notifications already enabled",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Banner should NOT be visible since notifications are already enabled
    await expect(
      po.page.getByTestId("notification-tip-banner"),
    ).not.toBeVisible();
  },
);
