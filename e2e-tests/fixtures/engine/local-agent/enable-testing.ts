import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Offer E2E testing and resume only after the user's decision",
  turns: [
    {
      text: "I'll ask you to enable testing first.",
      toolCalls: [{ name: "enable_testing", args: {} }],
    },
    { text: "Resumed after the testing decision." },
  ],
};
