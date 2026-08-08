import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Search for relevant files in codebase using code_search tool",
  turns: [
    {
      text: "I'll search for files related to React components in the codebase.",
      toolCalls: [
        {
          name: "code_search",
          args: {
            query: "React component rendering",
          },
        },
      ],
    },
    {
      text: "I found the relevant files! The main React component is in src/App.tsx which handles the app rendering.",
    },
  ],
};
