import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Drop a users table through the SQL tool",
  turns: [
    {
      text: "No description!",
      toolCalls: [
        {
          name: "execute_sql",
          args: { query: "DROP TABLE users;" },
        },
      ],
    },
    { text: "Done." },
  ],
};
