import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Run the Next.js production build",
  turns: [
    {
      text: "I'll verify the production build.",
      toolCalls: [
        {
          name: "run_build",
          args: {
            expected_prebuild_script: null,
            expected_build_script: "next build",
            expected_postbuild_script: null,
          },
        },
      ],
    },
    {
      text: "The production build verification is complete.",
    },
  ],
};
