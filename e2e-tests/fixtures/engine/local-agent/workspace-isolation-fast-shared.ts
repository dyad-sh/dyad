import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Worktree isolation: chat B writes src/shared.ts",
  turns: [
    {
      text: "Writing src/shared.ts for chat B.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/shared.ts",
            content: 'export const shared = "B";\n',
            description: "Chat B change",
          },
        },
      ],
    },
    { text: "Chat B is done." },
  ],
};
