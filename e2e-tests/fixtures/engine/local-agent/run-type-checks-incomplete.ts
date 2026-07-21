import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Make the TypeScript configuration invalid, then run a scoped type check",
  turns: [
    {
      text: "I'll update the TypeScript configuration for this test.",
      toolCalls: [
        {
          name: "search_replace",
          args: {
            file_path: "tsconfig.app.json",
            old_string: '    "baseUrl": ".",',
            new_string:
              '    "baseUrl": ".",\n    "definitelyInvalidCompilerOption": true,',
          },
        },
      ],
    },
    {
      text: "Now I'll run a scoped type check.",
      toolCalls: [
        {
          name: "run_type_checks",
          args: {
            paths: ["src/App.tsx"],
          },
        },
      ],
    },
    {
      text: "The project configuration must be fixed before type checking can complete.",
    },
  ],
};
