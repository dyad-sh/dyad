import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create the users table through execute_sql",
  turns: [
    {
      text: "I'll create the users table.",
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
    { text: "The users table is ready." },
  ],
};
