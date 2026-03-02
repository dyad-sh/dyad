import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Tests automatic retry after connection drop (e.g., TCP terminated mid-stream).
 * The fake server will destroy the socket on the 1st attempt, and the local agent
 * handler should automatically retry and succeed on the 2nd attempt.
 */
export const fixture: LocalAgentFixture = {
  description: "Automatic retry after connection drop",
  dropConnectionOnAttempts: [1],
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
