import type { McpListToolsResult, McpTool, McpToolConsent } from "@/ipc/types";
import { mcpConsentKey } from "@/hooks/useMcp";
import {
  mcpConnectionKey,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

export interface PluginToolSummary {
  /** Null until some configuration has listed its tools. */
  toolCount: number | null;
  /** Tools not denied, in the same configuration as `toolCount`. */
  enabledToolCount: number | null;
  /** Every configuration settled without a tool list. */
  discoveryFailed: boolean;
  /** Some configuration hasn't settled yet. */
  discovering: boolean;
}

/**
 * Tool counts for a plugin across its default and app-specific
 * configurations. Configurations of one plugin usually run the same
 * server, so the counts come from the configuration listing the most
 * tools rather than a sum.
 */
export function pluginToolSummary(
  connections: McpConnectionRef[],
  toolsByConnection: Record<string, McpTool[]>,
  statusByConnection: Record<string, McpListToolsResult["status"]>,
  consentsMap: Record<string, McpToolConsent["consent"]>,
): PluginToolSummary {
  let best: { total: number; enabled: number } | null = null;
  let discovering = false;
  for (const connection of connections) {
    const key = mcpConnectionKey(connection);
    const tools = toolsByConnection[key];
    if (!tools) {
      if (!statusByConnection[key]) discovering = true;
      continue;
    }
    const enabled = tools.filter(
      (t) => consentsMap[mcpConsentKey(connection, t.name)] !== "denied",
    ).length;
    if (!best || tools.length > best.total) {
      best = { total: tools.length, enabled };
    }
  }
  return {
    toolCount: best?.total ?? null,
    enabledToolCount: best?.enabled ?? null,
    discoveryFailed: !best && !discovering && connections.length > 0,
    discovering,
  };
}
