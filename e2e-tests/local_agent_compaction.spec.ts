import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for mid-stream auto-compaction in local-agent mode.
 *
 * Uses a custom model with a very small context window (500 tokens) so
 * that compaction triggers naturally during a multi-turn tool-call
 * conversation. Verifies the agent completes all turns successfully
 * despite compaction occurring mid-stream.
 */
testSkipIfWindows(
  "local-agent - mid-stream auto-compaction",
  async ({ po }) => {
    // 1. Enable Dyad Pro (required for local agent)
    await po.setUpDyadPro({ localAgent: true });

    // 2. Add a custom test provider + model with a tiny context window
    //    so compaction triggers after a couple of tool-call rounds.
    await po.goToSettingsTab();
    await po.setUpTestProvider();
    await po.setUpTestModel({ contextWindow: 500 });

    // 3. Import app and switch to the test model + local agent mode
    await po.goToAppsTab();
    await po.selectTestModel();
    await po.selectLocalAgentMode();
    await po.importApp("minimal");

    // 4. Run the multi-turn fixture that will trigger compaction
    await po.sendPrompt("tc=local-agent/compaction-test");

    // 5. Verify the agent completed all turns and applied edits
    await po.snapshotMessages();
    await po.snapshotAppFiles({
      name: "after-compaction",
      files: ["src/App.tsx"],
    });
  },
);
