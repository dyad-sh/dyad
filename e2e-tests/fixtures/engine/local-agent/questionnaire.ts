import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Present a planning questionnaire to the user",
  turns: [
    {
      text: "Let me ask you a few questions to understand your requirements.",
      toolCalls: [
        {
          name: "planning_questionnaire",
          args: {
            title: "Project Requirements",
            description: "Help me understand your project needs",
            questions: [
              {
                id: "framework",
                type: "radio",
                question: "Which framework do you prefer?",
                options: ["React", "Vue", "Svelte"],
                required: true,
              },
            ],
          },
        },
      ],
    },
    {
      text: "Thanks, I'll wait for your responses before proceeding.",
    },
  ],
};
