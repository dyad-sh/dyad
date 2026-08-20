import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Run the Vite production build",
  turns: [
    {
      text: "I'll verify the production build.",
      toolCalls: [
        {
          name: "run_build",
          args: {},
        },
      ],
    },
    {
      text: "The production build verification is complete.",
    },
  ],
};
