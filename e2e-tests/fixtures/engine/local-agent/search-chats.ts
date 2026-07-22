import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Search historical chats for a previous decision",
  turns: [
    {
      text: "I'll search the previous chats for that decision.",
      toolCalls: [
        {
          name: "search_chats",
          args: {
            query: "quartzneedle",
          },
        },
      ],
    },
    {
      text: "I found the previous discussion about the database decision.",
    },
  ],
};
