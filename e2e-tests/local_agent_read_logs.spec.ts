import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for read_logs tool in local-agent mode
 * Tests the ability to read and filter console logs with various parameters
 * Note: read_logs has defaultConsent: "always", so no consent flow is tested
 */

testSkipIfWindows("local-agent - read logs with filters", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  // Send prompt that triggers read_logs with various filters
  // The fixture tests multiple filter combinations:
  // - All logs from last 5 minutes
  // - Error logs from last hour
  // - Client logs from last minute
  await po.sendPrompt("tc=local-agent/read-logs");

  await po.snapshotMessages();
});
