import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a mini plan whose template is edited before approval",
  turns: [
    {
      text: "I drafted a mini plan for this app.",
      toolCalls: [
        {
          name: "write_mini_plan",
          args: {
            app_name: "Template Trial",
            user_prompt: "Build me a polished notes app",
            template_id: "react",
            theme_id: "default",
            design_direction:
              "Simple and professional with strong focus on readability.",
            main_color: "#2563EB",
          },
        },
      ],
    },
    {
      text: "Please review the mini plan and approve it to continue.",
    },
  ],
};
