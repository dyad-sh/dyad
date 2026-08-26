import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Return a simple text-only response",
  turns: [{ text: "This is a simple basic response" }],
};
