import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the code_search agent tool
 * Tests semantic code search in local-agent mode
 */

testSkipIfWindows("local-agent - code search", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/code-search");

  await po.snapshotMessages();
});
