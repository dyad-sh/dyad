import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix the deterministic TypeScript problem fixture",
  turns: [
    {
      text: "Fixing the selected TypeScript errors.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.tsx",
            content: `const App = () => <div>Minimal imported app</div>;

export default App;
`,
            description: "Fix the selected TypeScript errors",
          },
        },
      ],
    },
    { text: "The selected TypeScript errors are fixed." },
  ],
};
