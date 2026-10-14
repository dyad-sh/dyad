import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Worktree isolation: chat A writes src/feature-a.ts",
  turns: [
    {
      // Keeps this chat's writable turn running while another chat starts.
      delayMs: 6000,
      text: "Writing src/feature-a.ts for chat A.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/feature-a.ts",
            content: 'export const shared = "A";\n',
            description: "Chat A change",
          },
        },
      ],
    },
    { text: "Chat A is done." },
  ],
};
