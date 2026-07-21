import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Change an unsupported shared file so every Supabase function deploys",
  turns: [
    {
      text: "I'll update the shared Supabase configuration.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "supabase/functions/_shared/config.json",
            content: '{"version":2}\n',
            description: "Update the shared configuration",
          },
        },
      ],
    },
    {
      text: "Done. The shared configuration has been updated.",
    },
  ],
};
