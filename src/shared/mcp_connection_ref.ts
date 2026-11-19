/**
 * Names one MCP configuration Dyad can connect to.
 *
 * Every configuration belongs to a plugin (`mcp_servers.id`). A null
 * `appConfigId` names the plugin's default configuration, stored on its
 * `mcp_servers` row. A number names one of the plugin's app-specific
 * configurations, stored in `mcp_app_configs`.
 */
export interface McpConnectionRef {
  serverId: number;
  appConfigId: number | null;
}

export function pluginConnection(serverId: number): McpConnectionRef {
  return { serverId, appConfigId: null };
}

export function appConfigConnection(
  serverId: number,
  appConfigId: number,
): McpConnectionRef {
  return { serverId, appConfigId };
}

/** A string form of the ref, for map keys and cache keys. */
export function mcpConnectionKey(ref: McpConnectionRef): string {
  return ref.appConfigId === null
    ? String(ref.serverId)
    : `${ref.serverId}:${ref.appConfigId}`;
}

/** The inverse of mcpConnectionKey. */
export function parseMcpConnectionKey(key: string): McpConnectionRef {
  const match = /^(\d+)(?::(\d+))?$/.exec(key);
  if (!match) throw new Error(`Invalid MCP connection key: ${key}`);
  return {
    serverId: Number(match[1]),
    appConfigId: match[2] === undefined ? null : Number(match[2]),
  };
}
