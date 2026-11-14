import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Resume after the user enables or declines E2E testing",
  turns: [{ text: "Resumed after the testing decision." }],
};
