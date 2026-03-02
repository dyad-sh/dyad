import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Tests automatic retry after connection drop (e.g., TCP terminated mid-stream).
 * This fixture drops the connection on the first attempt of turn 1 (the
 * post-tool text turn), which is more realistic than dropping before any
 * tool activity. The local agent handler should automatically retry and
 * continue without re-running completed work.
 */
export const fixture: LocalAgentFixture = {
  description: "Automatic retry after connection drop",
  dropConnectionByTurn: [{ turnIndex: 1, attempts: [1] }],
  turns: [
    {
      text: "I'll create a file for you.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/recovered.ts",
            content: `export const recovered = true;\n`,
            description: "File created after connection recovery",
          },
        },
      ],
    },
    {
      text: "Successfully created the file after automatic retry.",
    },
  ],
};
