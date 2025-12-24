Creating a React app with console logging examples.

<dyad-write path="src/pages/Index.tsx" description="adding console logs">
import { useEffect } from 'react';

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
</dyad-write>
