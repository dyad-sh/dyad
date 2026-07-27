import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a React page that makes browser network requests",
  turns: [
    {
      text: "Creating a React app that makes network requests to test network logging.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `import { useEffect } from 'react';

function App() {
  useEffect(() => {
    fetch('https://jsonplaceholder.typicode.com/posts/1')
      .then(response => response.json())
      .then(data => {
        console.log('Fetched data:', data);
      })
      .catch(error => {
        console.error('Fetch error:', error);
      });

    fetch('https://jsonplaceholder.typicode.com/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Post',
        body: 'This is a test post',
        userId: 1,
      }),
    })
      .then(response => response.json())
      .then(data => {
        console.log('Posted data:', data);
      });
  }, []);

  return (
    <div>
      <h1>Network Requests Test App</h1>
      <p>Check the System Messages console for network logs.</p>
    </div>
  );
}

export default App;
`,
            description: "Add browser network request examples",
          },
        },
      ],
    },
    { text: "Network request examples are ready." },
  ],
};
