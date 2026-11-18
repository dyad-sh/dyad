import { Skeleton } from "@/components/ui/skeleton";
import type {
  McpListToolsResult,
  McpServer,
  McpTool,
  McpToolConsent,
} from "@/ipc/types";
import type { McpConnectionRef } from "@/shared/mcp_connection_ref";
import { pluginToolSummary } from "./pluginToolSummary";

export function PluginsStats({
  servers,
  connectionsFor,
  toolsByServer,
  statusByServer,
  consentsMap,
  isLoading,
}: {
  servers: McpServer[];
  connectionsFor: (server: McpServer) => McpConnectionRef[];
  // Both keyed by mcpConnectionKey.
  toolsByServer: Record<string, McpTool[]>;
  statusByServer: Record<string, McpListToolsResult["status"]>;
  consentsMap: Record<string, McpToolConsent["consent"]>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-5 w-56" />;
  }
  const enabled = servers.filter((s) => s.enabled);
  // Counted per plugin the same way as the cards, so a plugin with
  // several configurations isn't counted once per configuration.
  const summaries = enabled.map((s) =>
    pluginToolSummary(
      connectionsFor(s),
      toolsByServer,
      statusByServer,
      consentsMap,
    ),
  );
  // A placeholder only while a plugin has no tool list and discovery is
  // genuinely pending, matching the cards. A plugin whose listings all
  // failed contributes zero usable tools rather than holding the row on
  // the placeholder forever.
  const discovering = summaries.some(
    (t) => t.toolCount === null && t.discovering,
  );
  // Denied tools are not usable, so they don't count as enabled.
  const toolCount = summaries.reduce(
    (sum, t) => sum + (t.enabledToolCount ?? 0),
    0,
  );
  // The tool count only covers enabled plugins; naming the disabled
  // count explains the gap between the two numbers.
  const disabledCount = servers.length - enabled.length;
  return (
    <div className="text-sm text-muted-foreground" data-testid="plugins-stats">
      {servers.length} plugin{servers.length === 1 ? "" : "s"}
      {disabledCount > 0 ? ` (${disabledCount} disabled)` : ""} ·{" "}
      {discovering
        ? "— tools"
        : `${toolCount} tool${toolCount === 1 ? "" : "s"}`}{" "}
      enabled
    </div>
  );
}
