import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for local-agent connection retry resilience.
 * Verifies that the agent automatically recovers from transient connection
 * drops (e.g., TCP terminated mid-stream) by retrying the stream.
 */

testSkipIfWindows(
  "local-agent - recovers from connection drop",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // The connection-drop fixture drops the connection on the 1st attempt.
    // The local agent handler should automatically retry and succeed.
    await po.sendPrompt("tc=local-agent/connection-drop");

    // Verify the agent completed successfully by checking messages and file output
    await po.snapshotMessages();
    await po.snapshotAppFiles({
      name: "after-connection-retry",
      files: ["src/recovered.ts"],
    });
  },
);
