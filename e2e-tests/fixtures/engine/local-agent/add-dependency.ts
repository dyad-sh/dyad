import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Add a dependency that requires consent",
  turns: [
    {
      text: "I'll add a dependency to your project.",
      toolCalls: [
        {
          name: "add_dependency",
          args: {
            packages: ["@dyad-sh/supabase-management-js"],
          },
        },
      ],
    },
    {
      text: "Dependency added done.",
    },
  ],
};

