import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent mode (Agent v2)
 * Tests multi-turn tool call conversations using the TypeScript DSL fixtures
 */

testSkipIfWindows("local-agent - dump request", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotServerDump("all-messages");
});

testSkipIfWindows("local-agent - read then edit", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/read-then-edit");
  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-edit",
    files: ["src/App.tsx"],
  });
});

testSkipIfWindows("local-agent - parallel tool calls", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/parallel-tools");

  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-parallel",
    files: ["src/utils/math.ts", "src/utils/string.ts"],
  });
});

testSkipIfWindows("local-agent - questionnaire flow", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // Wait for the auto-generated AI_RULES response to fully complete,
  // then start a new chat to avoid the chat:stream:end event from the
  // AI_RULES stream clearing the questionnaire state.
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.clickNewChat();

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire", {
    skipWaitForCompletion: true,
  });

  // Wait for questionnaire UI to appear
  await expect(po.page.getByText("Which framework do you prefer?")).toBeVisible(
    {
      timeout: Timeout.MEDIUM,
    },
  );

  await expect(po.page.getByRole("button", { name: "Submit" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Select "Vue" radio option
  await po.page.getByText("Vue", { exact: true }).click();

  // Submit the questionnaire
  await po.page.getByRole("button", { name: /Submit/ }).click();

  // Wait for the LLM response after submitting answers
  await po.chatActions.waitForChatCompletion();

  // Snapshot the messages
  await po.snapshotMessages();
});
