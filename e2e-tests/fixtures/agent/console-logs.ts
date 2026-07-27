import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a React page that writes browser console logs",
  turns: [
    {
      text: "Creating a React app with console logging examples.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `import { useEffect } from 'react';

function App() {
  useEffect(() => {
    console.log('Hello from console.log');
    console.info('Info message');
    console.warn('Warning message');
    console.error('Test error message');
  }, []);

  return (
    <div>
      <h1>Console Logs Test App</h1>
      <p>Check the System Messages console for logs.</p>
    </div>
  );
}

export default App;
`,
            description: "Add browser console log examples",
          },
        },
      ],
    },
    { text: "Console logging examples are ready." },
  ],
};
