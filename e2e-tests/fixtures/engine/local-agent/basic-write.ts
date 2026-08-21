import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a simple TypeScript file",
  turns: [
    {
      text: "I'll create a hello function for you.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/hello.ts",
            content: `export function hello() {
  return "Hello, World!";
}
`,
            description: "Create hello function",
          },
        },
      ],
    },
    {
      text: "I've created the file successfully. The hello function is now available at src/hello.ts and is ready to use.",
    },
  ],
};

