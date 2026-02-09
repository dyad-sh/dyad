import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the code_search agent tool
 * Tests semantic code search in local-agent mode
 */

testSkipIfWindows("local-agent - code search", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.appManagement.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.chatActions.sendPrompt("tc=local-agent/code-search");

  await po.snapshotMessages();
});
