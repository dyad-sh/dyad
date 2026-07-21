import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Change a shared TypeScript module used by one Supabase function",
  turns: [
    {
      text: "I'll update the shared Supabase helper.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "supabase/functions/_shared/message.ts",
            content: 'export const message = "updated";\n',
            description: "Update the shared message helper",
          },
        },
      ],
    },
    {
      text: "Done. The shared helper has been updated.",
    },
  ],
};
