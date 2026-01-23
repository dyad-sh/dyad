import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E test for run_type_checks tool in local-agent mode
 * Tests that running type checks updates the Problems panel in the UI
 */

testSkipIfWindows(
  "local-agent - run_type_checks updates problems panel",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.selectLocalAgentMode();

    // Ensure pnpm install has run so TypeScript is available
    await po.ensurePnpmInstall();

    // Switch to Problems panel first to observe the update
    await po.selectPreviewMode("problems");

    // Initially there should be no problems
    const fixButton = po.page.getByTestId("fix-all-button");
    // The button may not exist if there are no problems, so we check for the "No problems found" text
    await expect(
      po.page.getByText(/No problems found|No Problems Report/),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Send prompt that triggers write_file with TS errors, then run_type_checks
    await po.sendPrompt("tc=local-agent/run-type-checks");

    // After the agent runs type checks, the Problems panel should show errors
    // Wait for the fix button to be enabled and show errors
    await expect(fixButton).toBeEnabled({ timeout: Timeout.LONG });
    await expect(fixButton).toContainText(/Fix \d+ problem/);

    // Verify the problems are displayed
    const problemRows = po.page.getByTestId("problem-row");
    await expect(problemRows.first()).toBeVisible({ timeout: Timeout.MEDIUM });

    // Take a snapshot of the problems pane for regression testing
    await po.snapshotProblemsPane();
  },
);
