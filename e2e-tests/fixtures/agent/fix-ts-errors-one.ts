import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix the remaining TypeScript error",
  turns: [
    {
      text: "Fixing the remaining TypeScript error.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/bad-file.ts",
            content: `const x = new Object();
x.toString();
`,
            description: "Fix the remaining TypeScript error",
          },
        },
      ],
    },
    { text: "The remaining TypeScript error was fixed." },
  ],
};
