import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { expect } from "@playwright/test";
import { test, testWithConfig } from "./helpers/test_helper";

const testWithNotificationsEnabled = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ enableChatEventNotifications: true }, null, 2),
    );
  },
});

test("notification banner - skip hides permanently", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Banner should be visible since notifications are not enabled
  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Get notified about chat events.");

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

test("notification banner - Enable enables notifications and hides banner", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();

  // Record settings before enabling
  const beforeSettings = po.settings.recordSettings();

  // Click the Enable button
  await banner.getByRole("button", { name: "Enable" }).click();

  // On macOS, a notification guide dialog appears — dismiss it
  if (os.platform() === "darwin") {
    const guideDialog = po.page.getByRole("dialog");
    await expect(guideDialog).toBeVisible();
    await guideDialog.getByRole("button", { name: "Got it" }).click();
    await expect(guideDialog).not.toBeVisible();
  }

  // Banner should be hidden after enabling
  await expect(banner).not.toBeVisible();

  // Verify settings were updated with enableChatEventNotifications: true
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
