import { MCPService } from '../../lib/services/mcpService.js';
import { McpConfig } from '../../lib/services/mcpSchemas.js';

export async function action({ request }: { request: Request }) {
  try {
    const mcpConfig = (await request.json()) as McpConfig;
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(mcpConfig);
    return Response.json(serverTools);
  } catch (error) {
    console.error('Failed to update MCP configuration:', error);
    return Response.json(
      { error: 'Failed to update MCP configuration' },
      { status: 500 }
    );
  }
}
