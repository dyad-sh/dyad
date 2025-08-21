# MCP Integration

This directory contains the complete Model Context Protocol (MCP) integration for the dyad application.

## Architecture

The MCP integration follows a layered architecture:

```
┌─────────────────┐
│   UI Components │  ← Settings tabs, server management
├─────────────────┤
│ State Management│  ← Jotai atoms for configuration
├─────────────────┤
│   API Endpoints │  ← IPC handlers for MCP functionality
├─────────────────┤
│  Service Layer  │  ← MCPService singleton
├─────────────────┤
│    AI SDK       │  ← experimental_createMCPClient
└─────────────────┘
```

## Files

- `mcpSchemas.ts` - TypeScript schemas and types for MCP configuration
- `mcpService.ts` - Core MCP service class that manages servers and tools
- `mcpTestConfigs.ts` - Test configurations for different transport types
- `README.md` - This documentation file

## Usage

### Basic Setup

1. Start the application and navigate to Settings
2. Look for the "MCP Servers Configuration" section
3. Add your MCP server configuration in JSON format
4. Use example configurations or create custom ones

### Example Configuration

```json
{
  "mcpServers": {
    "deepwiki": {
      "transport": {
        "type": "streamable-http",
        "url": "https://mcp.deepwiki.com/mcp"
      }
    }
  }
}
```

### Supported Transport Types

1. **STDIO Transport** - For local command-line tools
2. **SSE Transport** - For Server-Sent Events endpoints
3. **Streamable HTTP Transport** - For HTTP-based MCP servers

## Development

### Adding New Transport Types

1. Add the transport configuration schema to `mcpSchemas.ts`
2. Implement the transport creation in `MCPService.createTransport()`
3. Update the `TransportConfig` union type

### Testing

Run the test script to validate the integration:

```bash
node scripts/test-mcp.js
```

### Debugging

Enable detailed logging by setting log levels in the console:

```javascript
// Logs are available in the application logs with 'mcp-service' scope
```

## API Reference

### MCPService Class

#### Methods

- `getInstance()` - Get the singleton instance
- `updateConfig(config)` - Update MCP server configuration
- `checkServersAvailabilities()` - Check server connectivity
- `processToolCall(toolCall, dataStream)` - Process tool execution calls

#### Properties

- `tools` - All available tools with execute functions
- `toolsWithoutExecute` - Tools for LLM consumption only
- `mcpToolsPerServer` - Server status and tool information

## Troubleshooting

### Common Issues

1. **Server Connection Failed** - Check server URL and credentials
2. **Tool Execution Errors** - Verify tool parameters and server configuration
3. **Import Errors** - Ensure @modelcontextprotocol/sdk is properly installed

### Logs

Check the application logs for detailed error information with the 'mcp-service' scope.

## Security Considerations

- Always validate tool parameters before execution
- Use HTTPS for remote MCP servers
- Implement proper authentication where required
- Monitor tool execution for abuse patterns
