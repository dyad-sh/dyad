Creating a React app that makes network requests to test network logging.

<dyad-write path="src/pages/Index.tsx" description="adding network requests">
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Make a GET request
    fetch('https://jsonplaceholder.typicode.com/posts/1')
      .then(response => response.json())
      .then(data => {
        console.log('Fetched data:', data);
      })
      .catch(error => {
        console.error('Fetch error:', error);
      });

    // Make a POST request
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
</dyad-write>

