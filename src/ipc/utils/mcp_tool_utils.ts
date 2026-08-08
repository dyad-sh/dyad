/**
 * Utility functions for MCP (Model Context Protocol) tools
 */

/**
 * Separator used between server name and tool name in MCP tool keys.
 */
export const MCP_TOOL_KEY_SEPARATOR = "__";

/**
 * Parse an MCP tool key into its component parts.
 * Tool keys are formatted as "serverName__toolName".
 *
 * @param toolKey - The composite tool key (e.g., "my-server__my-tool")
 * @returns An object containing the serverName and toolName.
 *          If no separator is found, serverName will be empty and toolName will be the full key.
 */
export function parseMcpToolKey(toolKey: string): {
  serverName: string;
  toolName: string;
} {
  const lastIndex = toolKey.lastIndexOf(MCP_TOOL_KEY_SEPARATOR);
  if (lastIndex === -1) {
    return { serverName: "", toolName: toolKey };
  }
  const serverName = toolKey.slice(0, lastIndex);
  const toolName = toolKey.slice(lastIndex + MCP_TOOL_KEY_SEPARATOR.length);
  return { serverName, toolName };
}

/**
 * Build an MCP tool key from server name and tool name.
 *
 * @param serverName - The name of the MCP server
 * @param toolName - The name of the tool
 * @returns The composite tool key
 */
export function buildMcpToolKey(serverName: string, toolName: string): string {
  return `${serverName}${MCP_TOOL_KEY_SEPARATOR}${toolName}`;
}

/**
 * Sanitize a name for use in an MCP tool key.
 * Replaces any characters that aren't alphanumeric, underscore, or hyphen with a hyphen.
 *
 * @param name - The name to sanitize
 * @returns The sanitized name safe for use in tool keys
 */
export function sanitizeMcpName(name: string): string {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "-");
}
