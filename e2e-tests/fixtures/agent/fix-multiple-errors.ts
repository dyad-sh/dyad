import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix all errors reported by the preview",
  turns: [
    {
      text: "I'll fix all three runtime errors.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `const Index = () => <div>Fixed page</div>;

export default Index;
`,
            description: "Fix the index page error",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/components/ErrorComponent.tsx",
            content: `const ErrorComponent = () => <div>No runtime error</div>;

export default ErrorComponent;
`,
            description: "Fix the component error",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/utils/helper.ts",
            content: `export const fixedHelper = () => "fixed";
`,
            description: "Fix the helper error",
          },
        },
      ],
    },
    { text: "All three runtime errors are fixed." },
  ],
};
