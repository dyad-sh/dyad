import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Resolve a deterministic Git merge conflict",
  turns: [
    {
      text: "I'll resolve the conflict while preserving both changes.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "conflict.txt",
            content:
              "Line 1\nLine 2 Modified Main\nLine 2 Modified Feature\nLine 3\n",
            description: "Resolve merge conflict",
          },
        },
      ],
    },
    { text: "The merge conflict is resolved." },
  ],
};
