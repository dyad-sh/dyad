import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Exit plan mode after user accepts the plan",
  turns: [
    {
      text: "Great, let's proceed with the implementation.",
      toolCalls: [
        {
          name: "exit_plan",
          args: {
            confirmation: true,
          },
        },
      ],
    },
    {
      text: "Plan accepted. Switching to implementation mode.",
    },
  ],
};
