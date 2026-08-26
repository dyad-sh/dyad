import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write the main chat-flow smoke-test file",
  turns: [
    {
      text: "I'll create the file.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "file1.txt",
            content: "A file (2)\n",
            description: "Create the test file",
          },
        },
      ],
    },
    { text: "EOM" },
  ],
};
