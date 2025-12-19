import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Add a dependency that requires consent",
  turns: [
    {
      text: "I'll add lodash to your project.",
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
      text: "I've successfully added lodash to your project. You can now import it in your code.",
    },
  ],
};

