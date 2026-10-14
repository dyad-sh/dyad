import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Worktree isolation: chat B writes src/feature-b.ts",
  turns: [
    {
      text: "Writing src/feature-b.ts for chat B.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/feature-b.ts",
            content: 'export const shared = "B";\n',
            description: "Chat B change",
          },
        },
      ],
    },
    { text: "Chat B is done." },
  ],
};
