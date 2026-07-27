import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Generate AI rules for an imported app",
  turns: [
    {
      text: "I'll document the imported app's stack and coding rules.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "AI_RULES.md",
            content: `# Tech Stack

- React
- TypeScript
- Vite

# Rules

- Keep application source files in \`src/\`.
- Use React components for UI behavior.
- Use TypeScript for new source files.
`,
            description: "Create AI rules for the imported app",
          },
        },
      ],
    },
    { text: "AI_RULES.md is ready." },
  ],
};
