import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a users table through the SQL tool",
  turns: [
    {
      text: "Example SQL",
      toolCalls: [
        {
          name: "execute_sql",
          args: {
            query: "CREATE TABLE users (id serial primary key);",
            description: "create_users_table",
          },
        },
      ],
    },
    { text: "Done." },
  ],
};
