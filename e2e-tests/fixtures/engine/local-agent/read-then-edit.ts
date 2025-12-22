import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Read a file, then edit it with search/replace",
  turns: [
    {
      text: "Let me first read the current file contents to understand what we're working with.",
      toolCalls: [
        {
          name: "read_file",
          args: {
            path: "src/App.tsx",
          },
        },
      ],
    },
    {
      text: "Now I'll update the welcome message to say Hello World instead.",
      toolCalls: [
        {
          name: "search_replace",
          args: {
            path: "src/App.tsx",
            search: "const App = () => <div>Minimal imported app</div>;",
            replace: "const App = () => <div>UPDATED imported app</div>;",
            description: "Update welcome message",
          },
        },
      ],
    },
    {
      text: "Done! I've updated the title from 'Minimal imported app' to 'UPDATED imported app'. The change has been applied successfully.",
    },
  ],
};

