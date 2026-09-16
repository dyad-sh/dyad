import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Suggest connecting a catalog plugin mid-task",
  turns: [
    {
      text: "I need the E2E Open Server plugin for the next step.",
      toolCalls: [
        {
          name: "suggest_mcp_server",
          args: {
            slug: "e2e-open",
            reason: "Run the calculator tool to verify the totals.",
          },
        },
      ],
    },
    {
      text: "Continuing with the plugin connected.",
    },
  ],
};
