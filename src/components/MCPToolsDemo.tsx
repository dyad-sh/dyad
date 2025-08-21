import React, { useState } from 'react';
import { useMCPTools } from '../hooks/useMCPTools';

export function MCPToolsDemo() {
  const { tools, totalTools, availableServers, isLoading, error, executeTool, refreshTools } = useMCPTools();
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [isTesting, setIsTesting] = useState(false);

  const handleTestGoogleSearch = async () => {
    setIsTesting(true);
    try {
      console.log('Testing Google Search tool...');
      const result = await executeTool('google-search.google_search', { query: 'current gold price' });
      console.log('Google Search result:', result);
      setTestResults(prev => ({ ...prev, googleSearch: { success: true, result } }));
    } catch (error) {
      console.error('Google Search failed:', error);
      setTestResults(prev => ({ ...prev, googleSearch: { success: false, error: error instanceof Error ? error.message : String(error) } }));
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestFilesystem = async () => {
    setIsTesting(true);
    try {
      console.log('Testing Filesystem tool...');
      const result = await executeTool('filesystem.list_dir', { path: '.' });
      console.log('Filesystem result:', result);
      setTestResults(prev => ({ ...prev, filesystem: { success: true, result } }));
    } catch (error) {
      console.error('Filesystem tool failed:', error);
      setTestResults(prev => ({ ...prev, filesystem: { success: false, error: error instanceof Error ? error.message : String(error) } }));
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestSequentialThinking = async () => {
    setIsTesting(true);
    try {
      console.log('Testing Sequential Thinking tool...');
      const result = await executeTool('sequential-thinking.sequential_thinking', { 
        thought: 'I need to solve a complex problem step by step',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3
      });
      console.log('Sequential Thinking result:', result);
      setTestResults(prev => ({ ...prev, sequentialThinking: { success: true, result } }));
    } catch (error) {
      console.error('Sequential Thinking tool failed:', error);
      setTestResults(prev => ({ ...prev, sequentialThinking: { success: false, error: error instanceof Error ? error.message : String(error) } }));
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return <div>Loading MCP tools...</div>;
  }

  if (error) {
    return (
      <div>
        <h3>Error loading MCP tools:</h3>
        <p>{error}</p>
        <button onClick={refreshTools}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', margin: '20px' }}>
      <h2>MCP Tools Demo</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <h3>Status</h3>
        <p><strong>Total Tools:</strong> {totalTools}</p>
        <p><strong>Available Servers:</strong> {availableServers.join(', ') || 'None'}</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Available Tools</h3>
        {tools.length === 0 ? (
          <p>No MCP tools available. Check your MCP configuration.</p>
        ) : (
          <ul>
            {tools.map((tool) => (
              <li key={`${tool.serverName}-${tool.name}`}>
                <strong>{tool.name}</strong> ({tool.serverName})
                <br />
                <small>{tool.description}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Test MCP Tools</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <button 
            onClick={handleTestGoogleSearch}
            disabled={isTesting}
            style={{ padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            {isTesting ? 'Testing...' : 'Test Google Search'}
          </button>
          <button 
            onClick={handleTestFilesystem}
            disabled={isTesting}
            style={{ padding: '10px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            {isTesting ? 'Testing...' : 'Test Filesystem'}
          </button>
          <button 
            onClick={handleTestSequentialThinking}
            disabled={isTesting}
            style={{ padding: '10px 15px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '4px' }}
          >
            {isTesting ? 'Testing...' : 'Test Sequential Thinking'}
          </button>
          <button 
            onClick={refreshTools}
            disabled={isTesting}
            style={{ padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Refresh Tools
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Test Results</h3>
        {Object.keys(testResults).length === 0 ? (
          <p>No tests run yet. Click the test buttons above to test MCP tools.</p>
        ) : (
          <div>
            {Object.entries(testResults).map(([testName, result]) => (
              <div key={testName} style={{ marginBottom: '15px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: result.success ? '#28a745' : '#dc3545' }}>
                  {testName.charAt(0).toUpperCase() + testName.slice(1)} Test
                </h4>
                {result.success ? (
                  <div>
                    <p style={{ color: '#28a745', fontWeight: 'bold' }}>✅ Success!</p>
                    <pre style={{ backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px', overflow: 'auto' }}>
                      {JSON.stringify(result.result, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div>
                    <p style={{ color: '#dc3545', fontWeight: 'bold' }}>❌ Failed</p>
                    <p style={{ color: '#dc3545' }}>{result.error}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>How to Use in Chat</h3>
        <p>Now you can use MCP tools in chat with the AI using tags like:</p>
        <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', fontFamily: 'monospace' }}>
          <p><strong>Google Search:</strong></p>
          <p>&lt;mcp-tool tool="google-search.google_search"&gt;current gold price&lt;/mcp-tool&gt;</p>
          <br />
          <p><strong>Filesystem:</strong></p>
          <p>&lt;mcp-tool tool="filesystem.list_dir" args=&#123;&#123;"path": "."&#125;&#125;&gt;&lt;/mcp-tool&gt;</p>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#666' }}>
        <p>This component demonstrates the MCP tools integration. Check the browser console for detailed logs.</p>
      </div>
    </div>
  );
}
