import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Generate an image using the generate_image tool",
  turns: [
    {
      text: "I'll generate a hero image for your landing page.",
      toolCalls: [
        {
          name: "generate_image",
          args: {
            prompt:
              "A modern, minimal hero illustration of a rocket launching from a laptop screen, flat design style, blue and purple gradient background, clean lines",
          },
        },
      ],
    },
    {
      text: "I've generated the hero image and saved it to your project. You can find it in the .dyad/media directory.",
    },
  ],
};
