import { MCPService } from '../../lib/services/mcpService.js';

export async function loader() {
  try {
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.checkServersAvailabilities();
    return Response.json(serverTools);
  } catch (error) {
    console.error('Failed to check MCP servers:', error);
    return Response.json(
      { error: 'Failed to check MCP servers' },
      { status: 500 }
    );
  }
}
