import { Skeleton } from "@/components/ui/skeleton";
import type {
  McpListToolsResult,
  McpServer,
  McpTool,
  McpToolConsent,
} from "@/ipc/types";

export function PluginsStats({
  servers,
  toolsByServer,
  statusByServer,
  consentsMap,
  isLoading,
}: {
  servers: McpServer[];
  toolsByServer: Record<number, McpTool[]>;
  statusByServer: Record<number, McpListToolsResult["status"]>;
  consentsMap: Record<string, McpToolConsent["consent"]>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-5 w-56" />;
  }
  const enabled = servers.filter((s) => s.enabled);
  // A placeholder only while discovery is genuinely pending (no
  // settled status yet), matching the cards. A server whose listing
  // failed contributes zero usable tools rather than holding the row
  // on the placeholder forever.
  const discovering = enabled.some(
    (s) => !toolsByServer[s.id] && !statusByServer[s.id],
  );
  // Denied tools are not usable, so they don't count as enabled.
  const toolCount = enabled.reduce(
    (sum, s) =>
      sum +
      (toolsByServer[s.id] ?? []).filter(
        (t) => consentsMap[`${s.id}:${t.name}`] !== "denied",
      ).length,
    0,
  );
  return (
    <div className="text-sm text-muted-foreground" data-testid="plugins-stats">
      {servers.length} plugin{servers.length === 1 ? "" : "s"} ·{" "}
      {discovering
        ? "— tools"
        : `${toolCount} tool${toolCount === 1 ? "" : "s"}`}{" "}
      enabled
    </div>
  );
}
