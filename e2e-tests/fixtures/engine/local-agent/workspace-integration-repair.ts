import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Resolve the conflict Dyad reports while integrating an isolated chat workspace",
  turns: [
    {
      text: "I'll keep both chats' changes in the conflicted file.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/shared.ts",
            content: 'export const shared = "A and B";\n',
            description: "Combine both changes",
          },
        },
      ],
    },
    { text: "Both changes are combined." },
  ],
};
