import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create multiple rendered error cards",
  turns: [
    {
      text: "I will intentionally add multiple errors to test the Fix All Errors button.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `const Index = () => {
  throw new Error("First error in Index");
  return <div>Broken page</div>;
};

export default Index;
`,
            description: "Intentionally add first error",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/components/ErrorComponent.tsx",
            content: `const ErrorComponent = () => {
  throw new Error("Second error in ErrorComponent");
  return <div>This will never render</div>;
};

export default ErrorComponent;
`,
            description: "Intentionally add second error",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/utils/helper.ts",
            content: `export const brokenHelper = () => {
  throw new Error("Third error in helper");
};
`,
            description: "Intentionally add third error",
          },
        },
      ],
    },
    {
      text: `<dyad-output type="error" message="First error in Index">Error: First error in Index</dyad-output>
<dyad-output type="error" message="Second error in ErrorComponent">Error: Second error in ErrorComponent</dyad-output>
<dyad-output type="error" message="Third error in helper">Error: Third error in helper</dyad-output>`,
    },
  ],
};
