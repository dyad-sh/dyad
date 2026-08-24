import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write as root A and spawn a long-running Implementer",
  turns: [
    {
      text: "I'll update the shared app and delegate the related implementation.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/concurrent/root-a.ts",
            content: `export const rootA = true;
`,
            description: "Record root A's concurrent edit",
          },
        },
        {
          name: "spawn_agent",
          args: {
            persona: "implementer",
            task_name: "Long-running Sidekick A",
            assignment:
              "tc=local-agent/concurrent-writers-implementer-a",
            scope: ["src/concurrent"],
          },
        },
      ],
    },
    {
      text: "Root A has finished its own work and is waiting for its Sidekick.",
    },
  ],
};
