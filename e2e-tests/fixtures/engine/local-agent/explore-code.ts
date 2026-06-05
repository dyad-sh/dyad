import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Explore TypeScript code with the compiler-backed code explorer",
  turns: [
    {
      text: "I'll inspect the TypeScript symbols around the app component.",
      toolCalls: [
        {
          name: "explore_code",
          args: {
            query: "App component render flow",
            max_files: 4,
          },
        },
      ],
    },
    {
      text: "The app component is defined in src/App.tsx and rendered from src/main.tsx.",
    },
  ],
};
