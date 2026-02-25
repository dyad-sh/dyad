import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the generate_image agent tool
 * Tests image generation in local-agent mode
 */

testSkipIfWindows("local-agent - generate image", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/generate-image", {
    skipWaitForCompletion: true,
  });

  await po.agentConsent.waitForAgentConsentBanner();
  await po.agentConsent.clickAgentConsentAlwaysAllow();

  await po.chatActions.waitForChatCompletion();

  await po.snapshotMessages();
});
