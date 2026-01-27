import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Use search_replace to make a targeted edit to a file",
  turns: [
    {
      text: "Let me first read the file to see its contents.",
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
      text: "Now I'll use search_replace to update the text with proper context.",
      toolCalls: [
        {
          name: "search_replace",
          args: {
            file_path: "src/App.tsx",
            old_string: `const App = () => <div>Minimal imported app</div>;

export default App;`,
            new_string: `const App = () => <div>Updated via search_replace</div>;

export default App;`,
          },
        },
      ],
    },
    {
      text: "Done! I've updated the message using search_replace. The edit was applied successfully.",
    },
  ],
};
