import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Read a file in ask mode (read-only)",
  turns: [
    {
      text: "Let me read the file to explain its contents.",
      toolCalls: [
        {
          name: "read_file",
          args: {
            path: "src/App.tsx",
          },
        },
      ],
    },
    {
      text: "This is a simple React component that renders a div with the text 'Minimal imported app'. The component is exported as the default export.",
    },
  ],
};
