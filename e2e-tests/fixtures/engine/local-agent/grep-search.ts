import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Search for patterns in codebase using grep tool",
  turns: [
    {
      text: "I'll search for 'createRoot' in the codebase to find where the React app is initialized.",
      toolCalls: [
        {
          name: "grep",
          args: {
            query: "createRoot",
          },
        },
      ],
    },
    {
      text: "Now I'll search specifically in .tsx files for 'App' to find component references.",
      toolCalls: [
        {
          name: "grep",
          args: {
            query: "App",
            include_pattern: "*.tsx",
          },
        },
      ],
    },
    {
      text: "I found the matches! The React app is initialized in src/main.tsx using createRoot, and the App component is defined in src/App.tsx and imported in src/main.tsx.",
    },
  ],
};
