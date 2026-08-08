import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Read a file, then edit it with search_replace",
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
      text: "Now I'll update the welcome message to say UPDATED imported app instead.",
      toolCalls: [
        {
          name: "search_replace",
          args: {
            file_path: "src/App.tsx",
            old_string: "const App = () => <div>Minimal imported app</div>;",
            new_string: "const App = () => <div>UPDATED imported app</div>;",
          },
        },
      ],
    },
    {
      text: "Done! I've updated the title from 'Minimal imported app' to 'UPDATED imported app'. The change has been applied successfully.",
    },
  ],
};
