import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E test for the outer loop todo follow-up behavior.
 *
 * This tests that when an agent creates a todo list but only partially
 * completes it in the first pass, the outer loop will:
 * 1. Detect incomplete todos
 * 2. Inject a reminder message
 * 3. Run another pass to complete the remaining todos
 *
 * Related to issue #2601
 */
testSkipIfWindows("local-agent - todo follow-up loop", async ({ po }) => {
  await po.setUpConeyPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // Send prompt that triggers the todo follow-up loop fixture
  await po.sendPrompt("tc=local-agent/todo-followup-loop");

  // Snapshot the final messages to verify:
  // 1. All todos were created and completed across two passes
  // 2. The todo reminder was injected between passes
  // 3. Files were created in both passes
  await po.snapshotMessages();

  // Verify files were created in both passes
  await po.snapshotAppFiles({
    name: "after-todo-followup",
    files: [
      "src/utils/helper.ts", // Created in pass 1
      "src/utils/helper.test.ts", // Created in pass 2
      "src/utils/README.md", // Created in pass 2
    ],
  });
});
