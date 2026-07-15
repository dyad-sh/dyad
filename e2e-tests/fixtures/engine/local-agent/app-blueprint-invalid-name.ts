import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Create an app blueprint whose generated name contains characters that are invalid in folder names",
  turns: [
    {
      text: "I drafted an app blueprint for this app.",
      toolCalls: [
        {
          name: "write_app_blueprint",
          args: {
            app_name: "Food/Drink Planner: Café Edition",
            user_prompt: "Build me a meal planning app",
            template_id: "react",
            theme_id: "default",
            design_direction:
              "Fresh, appetizing interface with produce-inspired colors.",
            primary_color: "#22C55E",
            visuals: [
              {
                type: "logo",
                description: "App logo for the meal planner",
                prompt: "Minimal meal planner logo in fresh green tones",
              },
            ],
          },
        },
      ],
    },
    {
      text: "Please review the app blueprint and approve it to continue.",
    },
  ],
};
