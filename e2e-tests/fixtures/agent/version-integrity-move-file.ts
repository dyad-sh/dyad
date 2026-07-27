import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Move a file for version integrity",
  turns: [
    {
      text: "Moving a file.",
      toolCalls: [
        {
          name: "rename_file",
          args: { from: "dir/c.txt", to: "new-dir/d.txt" },
        },
      ],
    },
    { text: "File moved." },
  ],
};
