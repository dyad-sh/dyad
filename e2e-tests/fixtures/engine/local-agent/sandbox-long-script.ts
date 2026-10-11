import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Runs a CPU-bound sandbox script for several seconds. The interpreter runs
 * synchronously between host calls, so this script never yields: on the main
 * thread it would block every IPC request until it finishes (#4728). A plain
 * counting loop is used rather than a regex so the duration does not depend on
 * which interpreter builtins get optimized later.
 */
export const fixture: LocalAgentFixture = {
  description: "Run a long CPU-bound sandbox script",
  turns: [
    {
      text: "I'll crunch the numbers with a sandbox script.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Count to thirty million",
            script: [
              "function main() {",
              "  let i = 0;",
              "  while (i < 30000000) {",
              "    i = i + 1;",
              "  }",
              "  return i;",
              "}",
              "main();",
            ].join("\n"),
          },
        },
      ],
    },
    {
      text: "The long sandbox script finished.",
    },
  ],
};
