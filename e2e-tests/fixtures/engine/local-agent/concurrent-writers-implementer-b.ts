import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Delay briefly, then write and complete as Implementer B",
  turns: [
    {
      delayMs: 1_000,
      text: "I'll make the scoped Sidekick B edit.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/concurrent/sidekick-b.ts",
            content: `export const sidekickB = true;
`,
            description: "Record Sidekick B's concurrent edit",
          },
        },
      ],
    },
    {
      text: "Sidekick B completed successfully.",
    },
  ],
};
