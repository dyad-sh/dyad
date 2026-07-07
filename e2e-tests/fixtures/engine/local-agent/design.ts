import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Record a design spec using the write_design_spec tool",
  turns: [
    {
      text: "Here's a design system and the key screens for your app.",
      toolCalls: [
        {
          name: "write_design_spec",
          args: {
            title: "Test Design",
            summary: "A calm, minimal design for E2E testing.",
            designSystem: {
              mood: "calm, minimal, trustworthy",
              colors: [
                { name: "Primary", hex: "#4F46E5" },
                { name: "Background", hex: "#0B1020" },
              ],
              typography: {
                heading: "Inter 600",
                body: "Inter 400",
              },
              spacing: "8px grid, rounded-xl corners",
            },
            interfaces: [
              {
                id: "home",
                name: "Home screen",
                purpose: "See today's overview at a glance",
                prompt:
                  "A minimal home dashboard with a vertical list of cards, calm indigo accents on a near-black background.",
                copy: "Today · 3 of 5 done",
              },
              {
                id: "settings",
                name: "Settings screen",
                purpose: "Adjust preferences",
                prompt:
                  "A clean settings screen with grouped rows and toggles, consistent with the home screen's design system.",
              },
            ],
          },
        },
      ],
    },
    {
      text: "I've recorded the design. You can review the screens in the Design panel.",
    },
  ],
};
