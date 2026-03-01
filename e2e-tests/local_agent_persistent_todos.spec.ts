import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for persistent todos across turns.
 *
 * This tests that when an agent creates a todo list but doesn't complete
 * all items by the end of a turn, the incomplete todos are:
 * 1. Persisted to disk (.dyad/todos/<chatId>.json)
 * 2. Loaded at the start of the next turn
 * 3. Injected as a synthetic "[System]" message so the LLM is aware of them
 * 4. Completed by the agent in the subsequent turn
 *
 * Turn 1 (persistent-todos fixture):
 *   - Creates 3 todos, completes 1, leaves 2 incomplete
 *   - Followup loop fires once but doesn't complete remaining todos
 *   - Incomplete todos are saved to disk
 *
 * Turn 2 (persistent-todos-resume fixture):
 *   - Handler loads persisted todos and injects synthetic message
 *   - Agent picks up remaining work and completes all todos
 *   - Todos file is cleaned up (all completed)
 */
testSkipIfWindows(
  "local-agent - persistent todos across turns",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Turn 1: Creates incomplete todos that get persisted to disk
    await po.sendPrompt("tc=local-agent/persistent-todos");

    // Turn 2: Handler loads persisted todos, injects synthetic message,
    // and the agent completes the remaining work
    await po.sendPrompt("tc=local-agent/persistent-todos-resume");

    // Snapshot the final messages to verify:
    // 1. Turn 1 created todos and partially completed them
    // 2. Turn 2 resumed from persisted todos and completed them
    await po.snapshotMessages();

    // Verify files were created/updated across both turns
    await po.snapshotAppFiles({
      name: "after-persistent-todos",
      files: [
        "src/lib/utils.ts", // Created in turn 1, updated in turn 2
        "src/lib/utils.test.ts", // Created in turn 2
      ],
    });
  },
);
