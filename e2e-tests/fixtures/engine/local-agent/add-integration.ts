import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Prompt the user to set up a database integration",
  turns: [
    {
      text: "Let's connect a database first.",
      toolCalls: [
        {
          name: "add_integration",
          args: {},
        },
      ],
    },
    {
      text: "The database integration is connected.",
    },
  ],
};
