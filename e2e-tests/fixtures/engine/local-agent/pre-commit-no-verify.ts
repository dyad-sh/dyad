import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Create a file and run an always-failing pre-commit hook before turn commit",
  turns: [
    {
      text: "I'll create the requested file.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pre-commit-e2e.txt",
            content: "commit despite hook failure\n",
            description: "Create a file before the rejecting pre-commit hook",
          },
        },
      ],
    },
    {
      text: "Now I'll run the repository's pre-commit hook.",
      toolCalls: [{ name: "run_pre_commit", args: {} }],
    },
    {
      text: "The pre-commit hook still fails, so I'm reporting the remaining issue.",
    },
  ],
};
