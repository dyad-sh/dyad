import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Final text ends with suggested follow-up prompts for the chat input",
  turns: [
    {
      text: [
        "I added a friendly greeting to the home page.",
        "<dyad-suggested-prompts>",
        "Add a dark mode toggle",
        "Make the header responsive",
        "</dyad-suggested-prompts>",
      ].join("\n"),
    },
  ],
};
