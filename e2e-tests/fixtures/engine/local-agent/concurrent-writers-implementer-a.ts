import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write as Implementer A while another tool remains cancellable",
  turns: [
    {
      text: "I'll make the scoped Sidekick A edit.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/concurrent/sidekick-a.ts",
            content: `export const sidekickA = true;
`,
            description: "Record Sidekick A's concurrent edit",
          },
        },
        {
          name: "web_fetch",
          args: { url: "https://hang.example.com" },
        },
      ],
    },
  ],
};
