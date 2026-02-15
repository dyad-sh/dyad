import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

/**
 * E2E tests for the explore sub-agent feature.
 * Tests that the explore sub-agent gathers codebase context on the first message
 * when the setting is enabled.
 */

testSkipIfWindows(
  "local-agent - explore sub-agent runs on first message",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });

    // Enable the explore sub-agent setting
    await po.navigation.goToSettingsTab();
    await po.settings.toggleExploreSubAgent();
    await po.navigation.goToAppsTab();

    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Send a prompt - the explore sub-agent should run first
    await po.sendPrompt("tc=local-agent/simple-response");

    // Verify the explore status header appears (indicating explore phase ran)
    await expect(
      po.page.getByText("Exploring codebase", { exact: false }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Snapshot the messages to capture both explore output and main agent response
    await po.snapshotMessages();
  },
);

testSkipIfWindows(
  "local-agent - explore sub-agent does NOT run on second message",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });

    // Enable the explore sub-agent setting
    await po.navigation.goToSettingsTab();
    await po.settings.toggleExploreSubAgent();
    await po.navigation.goToAppsTab();

    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Send first message - explore sub-agent should run
    await po.sendPrompt("tc=local-agent/simple-response");

    // Verify explore status appeared on first message
    await expect(
      po.page.getByText("Exploring codebase", { exact: false }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Send second message - explore sub-agent should NOT run again
    await po.sendPrompt("tc=local-agent/simple-response");

    // Wait for completion
    await po.chatActions.waitForChatCompletion();

    // There should only be ONE "Exploring codebase" button (from the first message)
    // The DyadStatus component renders as a button with the title text
    const exploreStatuses = po.page.getByRole("button", {
      name: /Exploring codebase/,
    });
    await expect(exploreStatuses).toHaveCount(1);
  },
);

testSkipIfWindows(
  "local-agent - explore sub-agent disabled by default",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Send a prompt WITHOUT enabling explore sub-agent
    await po.sendPrompt("tc=local-agent/simple-response");

    // Wait for the main agent response to complete
    await po.chatActions.waitForChatCompletion();

    // Verify the explore status header does NOT appear
    await expect(
      po.page.getByText("Exploring codebase", { exact: false }),
    ).not.toBeVisible();
  },
);
