import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create TypeScript errors",
  turns: [
    {
      text: "This will get a TypeScript error.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.ts",
            content: `import NonExistentClass from 'non-existent-class';

const x = new Object();
x.nonExistentMethod();
`,
            description: "Create TypeScript errors",
          },
        },
      ],
    },
    { text: "EOM" },
  ],
};
