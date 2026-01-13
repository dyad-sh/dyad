import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for list_files tool with recursive parameter
 */

testSkipIfWindows("local-agent - list_files non-recursive", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/list-files-non-recursive");

  await po.snapshotMessages();
});

testSkipIfWindows("local-agent - list_files recursive", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/list-files-recursive");

  await po.snapshotMessages();
});
