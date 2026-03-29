import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a mini plan that renames the current app on approval",
  turns: [
    {
      text: "I drafted a mini plan for this app.",
      toolCalls: [
        {
          name: "write_mini_plan",
          args: {
            app_name: "Lumen Notes",
            user_prompt: "Build me a beautiful notes app",
            template_id: "react",
            theme_id: "default",
            design_direction:
              "Clean and polished productivity interface with warm accents.",
            main_color: "#F59E0B",
          },
        },
      ],
    },
    {
      text: "Please review the mini plan and approve it to continue.",
    },
  ],
};
