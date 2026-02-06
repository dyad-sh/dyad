import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that triggers compaction during the same user turn:
 * 1) First step makes a tool call and reports high token usage (200k)
 * 2) Second step returns final text after tool results
 *
 * Local agent should compact between step 1 and step 2.
 */
export const fixture: LocalAgentFixture = {
  description: "Trigger compaction between tool-loop steps in one turn",
  turns: [
    {
      text: "I'll inspect the file first.",
      toolCalls: [
        {
          name: "read_file",
          args: {
            path: "src/App.tsx",
          },
        },
      ],
      usage: {
        prompt_tokens: 199_900,
        completion_tokens: 100,
        total_tokens: 200_000,
      },
    },
    {
      text: "Done. I compacted context mid-turn and completed this request in the same response.",
    },
  ],
};
