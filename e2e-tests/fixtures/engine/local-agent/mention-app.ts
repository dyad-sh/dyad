import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Reference another app using @app:name mention",
  turns: [
    {
      text: "I can see the referenced app's codebase. I'll create a similar component based on the referenced app's structure.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/borrowed-component.tsx",
            content: `// Component inspired by minimal-with-ai-rules app
export function BorrowedComponent() {
  return <div>Borrowed from referenced app</div>;
}
`,
            description: "Create component based on referenced app",
          },
        },
      ],
    },
    {
      text: "I've created a new component based on the referenced app's structure. The file is at src/borrowed-component.tsx.",
    },
  ],
};

