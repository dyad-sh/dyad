import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "List files including hidden .coney files",
  turns: [
    {
      text: "I'll list all files including the hidden .coney directory for you.",
      toolCalls: [
        {
          name: "list_files",
          args: {
            recursive: true,
            include_hidden: true,
          },
        },
      ],
    },
    {
      text: "Here are all the files including the hidden .coney files.",
    },
  ],
};
