import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Attempt to add an unsafe npm dependency",
  turns: [
    {
      text: "I found a package to add for this app.",
      toolCalls: [
        {
          name: "add_dependency",
          args: { packages: ["axois"] },
        },
      ],
    },
    {
      text: "The dependency step finished.",
    },
  ],
};
