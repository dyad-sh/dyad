import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Create a file, run a pre-commit hook that fixes it, then rerun the hook",
  turns: [
    {
      text: "I'll create the file that needs to be fixed.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pre-commit-e2e.txt",
            content: "needs formatting\n",
            description: "Create a file that the pre-commit hook will fix",
          },
        },
      ],
    },
    {
      text: "Now I'll run the repository's pre-commit hook.",
      toolCalls: [{ name: "run_pre_commit", args: {} }],
    },
    {
      text: "The hook changed the file, so I'll rerun it to verify the fix.",
      toolCalls: [{ name: "run_pre_commit", args: {} }],
    },
    {
      text: "The pre-commit hook fixed the file and the verification run passed.",
    },
  ],
};
