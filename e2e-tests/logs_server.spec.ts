import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

/**
 * E2E tests for server logs in System Messages UI
 * Validates that server stdout/stderr logs are correctly classified as "server" type
 */

testSkipIfWindows(
  "system messages UI shows server logs with correct type",
  async ({ po }) => {
    await po.setUp();

    // Create an app to generate server logs
    await po.sendPrompt("tc=write-index");
    await po.approveProposal();

    // Wait for app to run - this generates server logs from stdout/stderr
    const picker = po.page.getByTestId("preview-pick-element-button");
    await expect(picker).toBeEnabled({ timeout: Timeout.EXTRA_LONG });

    // Open the system messages console
    const consoleHeader = po.page.locator('text="System Messages"').first();
    await consoleHeader.click();

    // Wait for console entries to appear
    await expect(async () => {
      const allLogs = po.page.getByTestId("console-entry");
      const count = await allLogs.count();
      expect(count).toBeGreaterThan(0);
      await expect(allLogs.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Verify that server logs have the "server" type badge visible
    // When typeFilter is "all" (default), the type badge should be shown
    // Server stdout/stderr logs and restart messages should show "server" type
    await expect(async () => {
      const serverTypeBadge = po.page
        .getByTestId("console-entry")
        .filter({ hasText: "server" });
      const count = await serverTypeBadge.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: Timeout.MEDIUM });

    // Test the type filter dropdown - filter by "server" type
    const typeFilter = po.page
      .locator("select")
      .filter({ hasText: "All Types" });
    await typeFilter.selectOption("server");

    // Verify logs are still visible after filtering by server type
    await expect(async () => {
      const serverLogs = po.page.getByTestId("console-entry");
      const count = await serverLogs.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);
