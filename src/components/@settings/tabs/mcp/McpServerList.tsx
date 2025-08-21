import { McpServerListItem } from "./McpServerListItem";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { MCPServerTools } from "../../../../lib/services/mcpSchemas";

interface McpServerListProps {
  serverTools: MCPServerTools;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function McpServerList({ serverTools, onRefresh, isRefreshing }: McpServerListProps) {
  const serverNames = Object.keys(serverTools);

  if (serverNames.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground text-sm">
          No MCP servers configured. Add a server to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Configured Servers ({serverNames.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {serverNames.map((serverName) => (
          <McpServerListItem
            key={serverName}
            serverName={serverName}
            serverData={serverTools[serverName]}
          />
        ))}
      </div>
    </div>
  );
}
