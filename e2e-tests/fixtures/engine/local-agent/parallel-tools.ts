import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Multiple tool calls in a single turn (parallel execution)",
  turns: [
    {
      text: "I'll create two files for you in parallel.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/utils/math.ts",
            content: `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`,
            description: "Create math utilities",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/utils/string.ts",
            content: `export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function lowercase(str: string): string {
  return str.toLowerCase();
}
`,
            description: "Create string utilities",
          },
        },
      ],
    },
    {
      text: "I've created both utility files:\n\n1. src/utils/math.ts - Contains add and subtract functions\n2. src/utils/string.ts - Contains capitalize and lowercase functions\n\nBoth files are now ready to use in your project.",
    },
  ],
};

