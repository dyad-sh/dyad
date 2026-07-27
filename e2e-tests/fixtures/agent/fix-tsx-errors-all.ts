import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix all TypeScript errors in the Problems test TSX file",
  turns: [
    {
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.tsx",
            content: `const App = () => <div>Minimal imported app</div>;

export default App;
`,
            description: "Fix all selected TypeScript errors",
          },
        },
      ],
    },
    { text: "All selected TypeScript errors were fixed." },
  ],
};
