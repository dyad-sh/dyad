import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Tests retry behavior when connection drops after tool-call chunks were emitted
 * but before the stream is finalized. This simulates an orphaned tool-call retry
 * window and ensures we don't duplicate tool execution.
 */
export const fixture: LocalAgentFixture = {
  description: "Connection drop after streaming tool-call chunks",
  dropConnectionAfterToolCallByTurn: [{ turnIndex: 0, attempts: [1] }],
  turns: [
    {
      text: "I'll create a file for you.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/recovered-after-tool-call.ts",
            content: `export const recoveredAfterToolCall = true;\n`,
            description: "File created after tool-call termination recovery",
          },
        },
      ],
    },
    {
      text: "Successfully created the file after retrying from a tool-call termination.",
    },
  ],
};
