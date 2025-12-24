import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * Tests for agent tool consent flow with add_dependency
 */

testSkipIfWindows(
  "local-agent - add_dependency consent: always allow",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.selectLocalAgentMode();

    // Send prompt that triggers add_dependency (requires consent)
    await po.sendPrompt("tc=local-agent/add-dependency", {
      skipWaitForCompletion: true,
    });

    // Wait for consent banner to appear
    await po.waitForAgentConsentBanner();

    // Click "Always allow" - should persist the consent
    await po.clickAgentConsentAlwaysAllow();

    // Wait for chat to complete
    await po.waitForChatCompletion();

    await po.snapshotMessages();

    // Send prompt that triggers add_dependency (should not require consent this time)
    await po.sendPrompt("tc=local-agent/add-dependency");
    await expect(po.getAgentConsentBanner()).not.toBeVisible();
  },
);

testSkipIfWindows(
  "local-agent - add_dependency consent: allow once",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.selectLocalAgentMode();

    // Send prompt that triggers add_dependency (requires consent)
    await po.sendPrompt("tc=local-agent/add-dependency", {
      skipWaitForCompletion: true,
    });

    // Wait for consent banner to appear
    await po.waitForAgentConsentBanner();

    // Click "Allow once" - should allow this execution only
    await po.clickAgentConsentAllowOnce();

    // Wait for chat to complete
    await po.waitForChatCompletion();

    await po.snapshotMessages();
  },
);

testSkipIfWindows(
  "local-agent - add_dependency consent: decline",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.selectLocalAgentMode();

    // Send prompt that triggers add_dependency (requires consent)
    await po.sendPrompt("tc=local-agent/add-dependency", {
      skipWaitForCompletion: true,
    });

    // Wait for consent banner to appear
    await po.waitForAgentConsentBanner();

    // Click "Decline" - should reject the tool execution
    await po.clickAgentConsentDecline();

    // Wait for chat to complete (should show error about declined permission)
    await po.waitForChatCompletion();

    await po.snapshotMessages();
  },
);
