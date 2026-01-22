import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "List files in directory recursively",
  turns: [
    {
      text: "I'll list all files in the src directory recursively for you.",
      toolCalls: [
        {
          name: "list_files",
          args: {
            directory: "src",
            recursive: true,
          },
        },
      ],
    },
    {
      text: "Here are all the files in the src directory and its subdirectories.",
    },
  ],
};
