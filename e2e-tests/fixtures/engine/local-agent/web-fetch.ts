import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fetch and read web page content using web_fetch tool",
  turns: [
    {
      text: "I'll fetch the content of that page for you.",
      toolCalls: [
        {
          name: "web_fetch",
          args: {
            url: "https://example.com/docs/getting-started",
          },
        },
      ],
    },
    {
      text: "Here's a summary of the page content. The getting started guide covers three main items. Let me know if you need more details!",
    },
  ],
};
