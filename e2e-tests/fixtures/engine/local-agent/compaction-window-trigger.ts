import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that returns usage below the default 128k context threshold but above
 * the remote catalog compaction_window configured for the default E2E model.
 */
export const fixture: LocalAgentFixture = {
  description: "Response with token usage that only triggers custom compaction",
  turns: [
    {
      text: "This response is below the default compaction threshold.",
      usage: {
        prompt_tokens: 49_900,
        completion_tokens: 100,
        total_tokens: 50_000,
      },
    },
  ],
};
