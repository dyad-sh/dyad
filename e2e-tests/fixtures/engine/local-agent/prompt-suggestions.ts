import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that calls set_prompt_suggestions to test the agent-mode prompt suggestion buttons.
 */
export const fixture: LocalAgentFixture = {
  description: "Returns prompt suggestions via set_prompt_suggestions tool",
  turns: [
    {
      text: "Here are some follow-up ideas you could try.",
      toolCalls: [
        {
          name: "set_prompt_suggestions",
          args: {
            suggestions: [
              {
                summary: "Add a contact form",
                prompt:
                  "Add a contact form to this page with name, email, and message fields.",
              },
              {
                summary: "Make it responsive",
                prompt:
                  "Make the layout responsive for mobile and tablet breakpoints.",
              },
            ],
          },
        },
      ],
    },
  ],
};
