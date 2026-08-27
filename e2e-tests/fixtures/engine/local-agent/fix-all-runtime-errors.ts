import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix all deterministic runtime errors",
  turns: [
    {
      text: "Fixing all reported errors.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "file1.txt",
            content: "A file (2)\n",
            description: "Record the runtime error fix",
          },
        },
      ],
    },
    { text: "All reported errors are fixed." },
  ],
};
