import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Search ignored files using grep",
  turns: [
    {
      text: "I'll search the ignored dependency folder for the requested symbol.",
      toolCalls: [
        {
          name: "grep",
          args: {
            query: "ignoredNeedle",
            include_pattern: "node_modules/ignored-pkg/**",
            include_ignored: true,
          },
        },
      ],
    },
    {
      text: "I found the symbol in the ignored dependency folder.",
    },
  ],
};
