import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent mode (Agent v2)
 * Tests multi-turn tool call conversations using the TypeScript DSL fixtures
 */

testSkipIfWindows("local-agent - dump request", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotServerDump("all-messages");
});

testSkipIfWindows("local-agent - read then edit", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

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
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/parallel-tools");

  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-parallel",
    files: ["src/utils/math.ts", "src/utils/string.ts"],
  });
});
