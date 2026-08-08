import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that returns a response with very high token usage (200k tokens)
 * to trigger context compaction marking. On the next message, the app will
 * perform compaction before processing.
 */
export const fixture: LocalAgentFixture = {
  description:
    "Response with high token usage to trigger compaction on next message",
  turns: [
    {
      text: "I've completed the initial analysis of the codebase. Here are the findings.",
      usage: {
        prompt_tokens: 199_900,
        completion_tokens: 100,
        total_tokens: 200_000,
      },
    },
  ],
};
