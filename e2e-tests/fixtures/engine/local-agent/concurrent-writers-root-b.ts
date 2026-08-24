import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write as root B and spawn an independently owned Implementer",
  turns: [
    {
      text: "I'll update the shared app and delegate another implementation.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/concurrent/root-b.ts",
            content: `export const rootB = true;
`,
            description: "Record root B's concurrent edit",
          },
        },
        {
          name: "spawn_agent",
          args: {
            persona: "implementer",
            task_name: "Independent Sidekick B",
            assignment:
              "tc=local-agent/concurrent-writers-implementer-b",
            scope: ["src/concurrent"],
          },
        },
      ],
    },
    {
      text: "Root B has finished its own work and is waiting for its Sidekick.",
    },
  ],
};
