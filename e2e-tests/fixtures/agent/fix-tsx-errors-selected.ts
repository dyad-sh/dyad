import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix the selected TypeScript errors in the Problems test",
  turns: [
    {
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.tsx",
            content: `const App = () => <div>Minimal imported app</div>;
nonExistentFunction2();

export default App;
`,
            description: "Fix the selected TypeScript errors",
          },
        },
      ],
    },
    { text: "The selected TypeScript errors were fixed." },
  ],
};
