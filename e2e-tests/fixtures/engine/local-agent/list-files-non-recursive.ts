import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "List files in directory without recursion",
  turns: [
    {
      text: "I'll list the files in the src directory for you.",
      toolCalls: [
        {
          name: "list_files",
          args: {
            directory: "src",
            recursive: false,
          },
        },
      ],
    },
    {
      text: "Here are the files in the src directory.",
    },
  ],
};
