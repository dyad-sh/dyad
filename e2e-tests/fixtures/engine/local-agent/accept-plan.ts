import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Present an implementation plan to the user",
  turns: [
    {
      text: "I'll create a plan for you.",
      toolCalls: [
        {
          name: "write_plan",
          args: {
            title: "Test Plan",
            summary: "A test implementation plan for E2E testing.",
            plan: "## Overview\n\nThis is a test plan.\n\n## Steps\n\n1. Step one\n2. Step two",
          },
        },
      ],
    },
    {
      text: "I've presented the implementation plan. You can review it in the preview panel and accept it when ready.",
    },
  ],
};
