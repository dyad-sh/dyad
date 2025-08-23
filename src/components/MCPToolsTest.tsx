import React from 'react';
import { useMCPTools } from '../hooks/useMCPTools';

export function MCPToolsTest() {
  const { tools, totalTools, availableServers, isLoading, error, executeTool, refreshTools } = useMCPTools();

  const handleTestGoogleSearch = async () => {
    try {
      console.log('Testing Google Search tool...');
      const result = await executeTool('google-search.google_search', { query: 'current gold price' });
      console.log('Google Search result:', result);
      alert(`Google Search successful! Check console for details.`);
    } catch (error) {
      console.error('Google Search failed:', error);
      alert(`Google Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleTestFilesystem = async () => {
    try {
      console.log('Testing Filesystem tool...');
      const result = await executeTool('filesystem.list_dir', { path: '.' });
      console.log('Filesystem result:', result);
      alert(`Filesystem tool successful! Check console for details.`);
    } catch (error) {
      console.error('Filesystem tool failed:', error);
      alert(`Filesystem tool failed: ${error instanceof Error ? error.message : String(error)}`);
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
      <h2>MCP Tools Test</h2>
      
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
              <li key={tool.name}>
                <strong>{tool.name}</strong> ({tool.serverName})
                <br />
                <small>{tool.description}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Test Tools</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button 
            onClick={handleTestGoogleSearch}
            style={{ padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Test Google Search
          </button>
          <button 
            onClick={handleTestFilesystem}
            style={{ padding: '10px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Test Filesystem
          </button>
          <button 
            onClick={refreshTools}
            style={{ padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Refresh Tools
          </button>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#666' }}>
        <p>This component tests the MCP tools integration. Check the browser console for detailed logs.</p>
      </div>
    </div>
  );
}
