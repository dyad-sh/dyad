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

const testWithBannerSkipped = testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ skipNotificationBanner: true }, null, 2),
    );
  },
});

test("notification banner - visible in chat and Enable navigates to settings", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Banner should be visible since notifications are not enabled
  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Turn on notifications so you know when chat responses are done",
  );

  // Click "Enable" button to navigate to settings
  await banner.getByRole("button", { name: "Enable" }).click();

  // Should navigate to settings page with the notification setting scrolled into view
  await expect(po.page.getByText("Workflow Settings")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    po.page.getByText("Show notification when chat completes"),
  ).toBeVisible({ timeout: 10000 });
});

test("notification banner - skip hides banner permanently", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Banner should be visible
  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();

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

testWithBannerSkipped(
  "notification banner - not shown when previously skipped",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Banner should NOT be visible since it was previously skipped
    await expect(
      po.page.getByTestId("notification-tip-banner"),
    ).not.toBeVisible();
  },
);
