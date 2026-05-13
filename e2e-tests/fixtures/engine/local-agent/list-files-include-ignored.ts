import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "List files including ignored .dyad files",
  turns: [
    {
      text: "I'll list all files including the ignored .dyad directory for you.",
      toolCalls: [
        {
          name: "list_files",
          args: {
            directory: ".dyad",
            recursive: true,
            include_ignored: true,
          },
        },
      ],
    },
    {
      text: "Here are the ignored .dyad files.",
    },
  ],
};
