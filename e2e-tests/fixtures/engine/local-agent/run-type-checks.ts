import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Write a file with TypeScript errors and then run type checks to update the Problems panel",
  turns: [
    {
      text: "I'll create a file with some TypeScript errors for testing.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/test-errors.ts",
            content: `// File with TypeScript errors for testing
const x: number = "not a number";
const y: string = 123;
nonExistentFunction();
`,
            description: "Create file with type errors",
          },
        },
      ],
    },
    {
      text: "Now let me run type checks to identify the errors.",
      toolCalls: [
        {
          name: "run_type_checks",
          args: {
            paths: ["src/test-errors.ts"],
          },
        },
      ],
    },
    {
      text: "The type check found the errors. The Problems panel should now show these TypeScript errors.",
    },
  ],
};
