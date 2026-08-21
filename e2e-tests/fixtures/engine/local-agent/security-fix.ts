import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix a security issue in the codebase",
  turns: [
    {
      text: "I'll fix the security issue by removing the hardcoded secret and using environment variables instead.",
      toolCalls: [
        {
          name: "search_replace",
          args: {
            path: "src/App.tsx",
            search: "const App = () => <div>Minimal imported app</div>;",
            replace:
              "const App = () => <div>Secure app with env vars</div>;",
            description: "Fix security vulnerability",
          },
        },
      ],
    },
    {
      text: "I've fixed the security issue by replacing the hardcoded value with a more secure implementation using environment variables.",
    },
  ],
};

