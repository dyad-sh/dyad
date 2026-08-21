import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create an app blueprint whose template is edited before approval",
  turns: [
    {
      text: "I drafted an app blueprint for this app.",
      toolCalls: [
        {
          name: "write_app_blueprint",
          args: {
            app_name: "Template Trial",
            user_prompt: "Build me a polished notes app",
            template_id: "react",
            theme_id: "default",
            design_direction:
              "Simple and professional with strong focus on readability.",
            primary_color: "#2563EB",
            visuals: [
              {
                type: "logo",
                description: "App logo for the notes dashboard",
                prompt: "Minimal notes app logo in cobalt blue",
              },
            ],
          },
        },
      ],
    },
    {
      text:
        "Please review the app blueprint and approve it to continue. ".repeat(
          100,
        ),
    },
  ],
};
