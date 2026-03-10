import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for web_fetch tool in local-agent mode
 * Tests fetching and reading web page content as markdown
 * Note: web_fetch has defaultConsent: "always", so no consent flow is tested
 */

testSkipIfWindows("local-agent - web fetch", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/web-fetch");

  await po.snapshotMessages();
});
