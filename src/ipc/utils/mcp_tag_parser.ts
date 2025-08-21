import log from "electron-log";

const logger = log.scope("mcp_tag_parser");

export interface MCPToolCall {
  toolName: string;
  args: any;
  description?: string;
}

export function getMCPToolTags(fullResponse: string): MCPToolCall[] {
  const mcpToolRegex = /<mcp-tool([^>]*)>([\s\S]*?)<\/mcp-tool>/gi;
  const toolNameRegex = /tool="([^"]+)"/;
  const argsRegex = /args="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const toolCalls: MCPToolCall[] = [];

  while ((match = mcpToolRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    const content = match[2].trim();

    const toolNameMatch = toolNameRegex.exec(attributesString);
    const argsMatch = argsRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (toolNameMatch && toolNameMatch[1]) {
      const toolName = toolNameMatch[1];
      let args = {};

      // Try to parse args from attributes first
      if (argsMatch && argsMatch[1]) {
        try {
          args = JSON.parse(argsMatch[1]);
        } catch (error) {
          logger.warn(`Failed to parse args for tool ${toolName}:`, error);
        }
      }

      // If no args in attributes, try to parse from content
      if (Object.keys(args).length === 0 && content.trim()) {
        try {
          args = JSON.parse(content);
        } catch (error) {
          logger.warn(`Failed to parse args from content for tool ${toolName}:`, error);
          // If JSON parsing fails, treat content as a simple string argument
          args = { query: content.trim() };
        }
      }

      const description = descriptionMatch?.[1];

      toolCalls.push({
        toolName,
        args,
        description,
      });

      logger.info(`Found MCP tool call: ${toolName} with args:`, args);
    } else {
      logger.warn("Found <mcp-tool> tag without a valid 'tool' attribute:", match[0]);
    }
  }

  return toolCalls;
}

export function replaceMCPToolTags(fullResponse: string, results: Map<string, any>): string {
  let processedResponse = fullResponse;

  const mcpToolRegex = /<mcp-tool([^>]*)>([\s\S]*?)<\/mcp-tool>/gi;
  
  processedResponse = processedResponse.replace(mcpToolRegex, (match, attributesString, content) => {
    const toolNameMatch = /tool="([^"]+)"/.exec(attributesString);
    
    if (toolNameMatch && toolNameMatch[1]) {
      const toolName = toolNameMatch[1];
      const result = results.get(toolName);
      
      if (results.has(toolName)) {
        if (result.error) {
          return `**MCP Tool Error (${toolName}):** ${result.error}`;
        } else {
          return `**MCP Tool Result (${toolName}):** ${JSON.stringify(result, null, 2)}`;
        }
      } else {
        return `**MCP Tool Pending (${toolName}):** Tool execution in progress...`;
      }
    }
    
    return match; // Keep original if we can't parse it
  });

  return processedResponse;
}
