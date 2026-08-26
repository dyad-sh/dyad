import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write a file whose legacy description contained angle brackets",
  turns: [
    {
      text: "BEFORE TOOL",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/foo/bar.tsx",
            content: "// BEGINNING OF FILE\n",
            description: "page to use <a> and <b> tags",
          },
        },
      ],
    },
    { text: "AFTER TOOL" },
  ],
};
