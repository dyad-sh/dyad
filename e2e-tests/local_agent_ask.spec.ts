import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent in ask mode (read-only mode for Pro users)
 * Tests that Pro users in ask mode get access to read-only tools
 */

testSkipIfWindows("local-agent ask mode", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.appManagement.importApp("minimal");

  // Select ask mode - local agent will be used in read-only mode for Pro users
  await po.chatActions.selectChatMode("ask");

  // Test read-only tools work
  await po.chatActions.sendPrompt("tc=local-agent/ask-read-file");
  await po.snapshotMessages();

  // Dump request to verify only read-only tools are provided
  await po.chatActions.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
});
