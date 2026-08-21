import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Inspect a file through the sandbox in ask mode (read-only)",
  turns: [
    {
      text: "Let me inspect the file in a read-only sandbox.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            script:
              'const text = await read_file("src/App.tsx"); text.length;',
            description: "Check App.tsx length",
          },
        },
      ],
    },
    {
      text: "This is a simple React component that renders a div with the text 'Minimal imported app'. The component is exported as the default export.",
    },
  ],
};
