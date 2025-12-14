import { expect } from "@playwright/test";
import { Timeout, testWithConfig } from "./helpers/test_helper";
import * as fs from "node:fs";
import * as path from "node:path";

testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Set up a force-close scenario by creating settings with isRunning: true
    // and lastKnownPerformance data
    const settingsPath = path.join(userDataDir, "user-settings.json");
    const settings = {
      hasRunBefore: true,
      isRunning: true, // Simulate force-close
      enableAutoUpdate: false,
      releaseChannel: "stable",
      lastKnownPerformance: {
        timestamp: Date.now() - 5000, // 5 seconds ago
        memoryUsageMB: 256,
        cpuUsagePercent: 45.5,
        systemMemoryUsageMB: 8192,
        systemMemoryTotalMB: 16384,
        systemMemoryPercent: 50.0,
        systemCpuPercent: 35.2,
      },
    };

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
})(
  "force-close detection shows dialog with performance data",
  async ({ po }) => {
    // Wait for the home page to be visible first
    await expect(po.getHomeChatInputContainer()).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Check if the force-close dialog is visible by looking for the heading
    await expect(
      po.page.getByRole("heading", { name: "Force Close Detected" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Verify the warning message
    await expect(
      po.page.getByText(
        "The app was not closed properly the last time it was running",
      ),
    ).toBeVisible();

    // Verify performance data is displayed
    await expect(po.page.getByText("Last Known State:")).toBeVisible();

    // Check Process Metrics section
    await expect(po.page.getByText("Process Metrics")).toBeVisible();
    await expect(po.page.getByText("256 MB")).toBeVisible();
    await expect(po.page.getByText("45.5%")).toBeVisible();

    // Check System Metrics section
    await expect(po.page.getByText("System Metrics")).toBeVisible();
    await expect(po.page.getByText("8192 / 16384 MB")).toBeVisible();
    await expect(po.page.getByText("35.2%")).toBeVisible();

    // Close the dialog
    await po.page.getByRole("button", { name: "OK" }).click();

    // Verify dialog is closed by checking the heading is no longer visible
    await expect(
      po.page.getByRole("heading", { name: "Force Close Detected" }),
    ).not.toBeVisible();
  },
);

testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Set up scenario without force-close (proper shutdown)
    const settingsPath = path.join(userDataDir, "user-settings.json");
    const settings = {
      hasRunBefore: true,
      isRunning: false, // Proper shutdown - no force-close
      enableAutoUpdate: false,
      releaseChannel: "stable",
      lastKnownPerformance: {
        timestamp: Date.now() - 5000,
        memoryUsageMB: 256,
        cpuUsagePercent: 45.5,
        systemMemoryUsageMB: 8192,
        systemMemoryTotalMB: 16384,
        systemMemoryPercent: 50.0,
        systemCpuPercent: 35.2,
      },
    };

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
})("no force-close dialog when app was properly shut down", async ({ po }) => {
  // Verify the home page loaded normally
  await expect(po.getHomeChatInputContainer()).toBeVisible({
    timeout: Timeout.LONG,
  });

  // Verify that the force-close dialog is NOT shown
  await expect(
    po.page.getByRole("heading", { name: "Force Close Detected" }),
  ).not.toBeVisible();
});

testWithConfig({})(
  "performance information is being captured during normal operation",
  async ({ po, electronApp }) => {
    // Wait for the app to load
    await expect(po.getHomeChatInputContainer()).toBeVisible({
      timeout: Timeout.LONG,
    });

    // Get the user data directory
    const userDataDir = (electronApp as any).$dyadUserDataDir;
    const settingsPath = path.join(userDataDir, "user-settings.json");

    // Wait a bit to allow performance monitoring to capture at least one data point
    // Performance monitoring runs every 30 seconds, but we'll wait 35 seconds to be safe
    await po.page.waitForTimeout(35000);

    // Read the settings file
    const settingsContent = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(settingsContent);

    // Verify that lastKnownPerformance exists and has all required fields
    expect(settings.lastKnownPerformance).toBeDefined();
    expect(settings.lastKnownPerformance.timestamp).toBeGreaterThan(0);
    expect(settings.lastKnownPerformance.memoryUsageMB).toBeGreaterThan(0);
    expect(
      settings.lastKnownPerformance.cpuUsagePercent,
    ).toBeGreaterThanOrEqual(0);
    expect(settings.lastKnownPerformance.systemMemoryUsageMB).toBeGreaterThan(
      0,
    );
    expect(settings.lastKnownPerformance.systemMemoryTotalMB).toBeGreaterThan(
      0,
    );
    expect(
      settings.lastKnownPerformance.systemCpuPercent,
    ).toBeGreaterThanOrEqual(0);

    // Verify the timestamp is recent (within the last minute)
    const now = Date.now();
    const timeDiff = now - settings.lastKnownPerformance.timestamp;
    expect(timeDiff).toBeLessThan(60000); // Less than 1 minute old
  },
);
