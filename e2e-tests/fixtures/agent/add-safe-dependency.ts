import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Add a safe npm dependency",
  turns: [
    {
      text: "I found a safe package to add for this app.",
      toolCalls: [
        {
          name: "add_dependency",
          args: { packages: ["lodash"] },
        },
      ],
    },
    {
      text: "The dependency was added.",
    },
  ],
};
