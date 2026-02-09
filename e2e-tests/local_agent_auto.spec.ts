import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("local-agent - auto model", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true, localAgentUseAutoModel: true });
  await po.appManagement.importApp("minimal");

  await po.chatActions.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
});
