import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Run type checks on a clean TypeScript app",
  turns: [
    {
      text: "I'll run type checks across the app.",
      toolCalls: [
        {
          name: "run_type_checks",
          args: {},
        },
      ],
    },
    {
      text: "The type check completed successfully with no errors.",
    },
  ],
};
