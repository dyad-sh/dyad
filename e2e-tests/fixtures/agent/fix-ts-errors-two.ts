import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix two TypeScript errors and leave one",
  turns: [
    {
      text: "Fixing the TypeScript errors.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.ts",
            content: `// Import removed.
const x = new Object();
x.nonExistentMethod2();
`,
            description: "Fix two TypeScript errors",
          },
        },
      ],
    },
    { text: "Two TypeScript errors were fixed." },
  ],
};
