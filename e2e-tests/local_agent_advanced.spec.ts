import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

/**
 * Test for security review in local-agent mode
 */
testSkipIfWindows("local-agent - security review fix", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // First, trigger a security review
  await po.previewPanel.selectPreviewMode("security");
  await po.securityReview.clickRunSecurityReview();

  await po.snapshotServerDump("all-messages");
});

/**
 * Test for mention apps feature in local-agent mode
 */
testSkipIfWindows("local-agent - mention apps", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });

  // Import app and reference it.
  await po.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.selectLocalAgentMode();

  // Use @app:minimal-with-ai-rules to reference the other app
  await po.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("request");
});

/**
 * Test for enable_nitro tool in local-agent mode on a Vite app.
 */
testSkipIfWindows("local-agent - enable nitro", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/enable-nitro", {
    skipWaitForCompletion: true,
  });

  // Install of Nitro dependencies goes through socket firewall, which can be slow on first run.
  await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

  await po.snapshotMessages();
});
