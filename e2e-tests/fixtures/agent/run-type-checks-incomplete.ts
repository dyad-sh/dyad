import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Make the TypeScript configuration invalid, then run a scoped type check",
  turns: [
    {
      text: "I'll update the TypeScript configuration for this test.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "tsconfig.app.json",
            content:
              '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "jsx": "react-jsx",\n    "noEmit": true,\n    "baseUrl": ".",\n    "definitelyInvalidCompilerOption": true,\n    "paths": {\n      "@/*": ["./src/*"]\n    }\n  },\n  "include": ["src"]\n}\n',
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
