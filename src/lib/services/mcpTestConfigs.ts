// Test configurations for different MCP transport types
// These can be used to test the MCP integration

export const MCP_TEST_CONFIGS = {
  // STDIO Transport Test
  stdio: {
    mcpServers: {
      "test-everything": {
        transport: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
          cwd: process.cwd(),
        },
      },
      "test-filesystem": {
        transport: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          cwd: process.cwd(),
        },
      },
    },
  },

  // SSE Transport Test
  sse: {
    mcpServers: {
      "test-sse": {
        transport: {
          type: "sse" as const,
          url: "http://localhost:8000/sse",
          headers: {
            "Authorization": "Bearer test-token",
          },
        },
      },
    },
  },

  // Streamable HTTP Transport Test
  streamableHttp: {
    mcpServers: {
      "test-deepwiki": {
        transport: {
          type: "streamable-http" as const,
          url: "https://mcp.deepwiki.com/mcp",
          headers: {
            "User-Agent": "dyad-mcp-client/1.0",
          },
        },
      },
    },
  },

  // Mixed Transport Test
  mixed: {
    mcpServers: {
      "mixed-everything": {
        transport: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
        },
      },
      "mixed-deepwiki": {
        transport: {
          type: "streamable-http" as const,
          url: "https://mcp.deepwiki.com/mcp",
        },
      },
    },
  },
};

// Test function to validate MCP configuration
export async function testMCPConfiguration() {
  const { MCPService } = await import('./mcpService.js');

  console.log('Testing MCP configurations...\n');

  for (const [configName, config] of Object.entries(MCP_TEST_CONFIGS)) {
    console.log(`Testing configuration: ${configName}`);
    console.log('Configuration:', JSON.stringify(config, null, 2));

    try {
      const mcpService = MCPService.getInstance();
      const serverTools = await mcpService.updateConfig(config);

      console.log('✅ Configuration loaded successfully');
      console.log('Server tools:', serverTools);

      // Test server availability
      const availability = await mcpService.checkServersAvailabilities();
      console.log('Server availability:', availability);

    } catch (error) {
      console.error('❌ Configuration failed:', error);
    }

    console.log('---\n');
  }
}

// Test function to validate tool execution
export async function testMCPToolExecution() {
  const { MCPService } = await import('./mcpService.js');

  console.log('Testing MCP tool execution...\n');

  try {
    const mcpService = MCPService.getInstance();

    // Use the everything server for testing
    const config = MCP_TEST_CONFIGS.stdio;
    await mcpService.updateConfig(config);

    // Get available tools
    const tools = mcpService.toolsWithoutExecute;
    console.log('Available tools:', Object.keys(tools));

    // Test a simple tool if available
    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      const firstTool = toolNames[0];
      console.log(`Testing tool: ${firstTool}`);

      // Note: Actual tool execution would require a real MCP server
      // This is just testing the service layer
      console.log('✅ Tool execution setup successful');
    } else {
      console.log('⚠️ No tools available');
    }

  } catch (error) {
    console.error('❌ Tool execution test failed:', error);
  }
}

// Export test utilities
export const TEST_UTILITIES = {
  testMCPConfiguration,
  testMCPToolExecution,
};
