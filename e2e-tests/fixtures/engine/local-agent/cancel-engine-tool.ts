import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Invoke a web fetch whose engine request never completes",
  turns: [
    {
      text: "I'll fetch that page now.",
      toolCalls: [
        {
          name: "web_fetch",
          args: { url: "https://hang.example.com" },
        },
      ],
    },
  ],
};
