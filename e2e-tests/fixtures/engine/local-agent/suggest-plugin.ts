import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Suggest connecting a catalog plugin mid-task",
  turns: [
    {
      text: "I need the E2E Open Server plugin for the next step.",
      toolCalls: [
        {
          name: "suggest_plugin",
          args: {
            slug: "e2e-open",
            reason: "Run the calculator tool to verify the totals.",
          },
        },
      ],
    },
    // Served after the tool result and again on a follow-up turn, so it
    // must read correctly whether the user connected or declined.
    {
      text: "Carrying on from here.",
    },
  ],
};
