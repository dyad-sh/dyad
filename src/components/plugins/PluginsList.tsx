import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMcp } from "@/hooks/useMcp";
import type { McpServer } from "@/ipc/types";
import {
  mcpConnectionKey,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";
import { useMcpCatalog } from "@/hooks/useMcpCatalog";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { AddPluginDialog, useOauthStorageEncrypted } from "./AddPluginDialog";
import { OauthPlaintextStorageAlert } from "./OauthPlaintextStorageAlert";
import { PluginSummaryCard } from "./PluginSummaryCard";
import { PluginsStats } from "./PluginsStats";
import { connectionSetupState, pluginSwitchLocked } from "./pluginSetup";
import { pluginToolSummary } from "./pluginToolSummary";
import { usePluginConnect } from "./usePluginConnect";

export function PluginsList({
  addDialogOpen,
  onAddDialogOpenChange,
}: {
  addDialogOpen: boolean;
  onAddDialogOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // Gate on the servers query alone: tool discovery can take seconds,
  // and the cards already render a placeholder count until it lands.
  const {
    servers,
    appConfigs,
    toolsByServer,
    statusByServer,
    consentsMap,
    isServersLoading,
    toggleEnabled,
  } = useMcp();
  const { connectingKey, feedbackFor, onServerCreated, onConnect } =
    usePluginConnect();

  const oauthStorageEncrypted = useOauthStorageEncrypted();

  const catalogQuery = useMcpCatalog();
  // A server's catalog entry supplies its icon and its declared setup
  // fields, so a card can tell whether any are still unfilled.
  const entryBySlug = useMemo(() => {
    const map = new Map<string, McpCatalogEntry>();
    for (const e of catalogQuery.data?.entries ?? []) {
      map.set(e.slug, e);
    }
    return map;
  }, [catalogQuery.data]);

  // Any server holding a credential we'd store without encryption:
  // OAuth tokens and client secrets, request headers, or env vars.
  const hasStoredSecret = useMemo(
    () =>
      [...(servers || []), ...appConfigs].some(
        (s) =>
          (s.transport === "http" && s.oauthEnabled) ||
          Object.keys(s.headersJson ?? {}).length > 0 ||
          Object.keys(s.envJson ?? {}).length > 0,
      ),
    [servers, appConfigs],
  );
  const showPlaintextBanner =
    oauthStorageEncrypted === false && hasStoredSecret;

  // A plugin's default configuration plus its app-specific ones.
  const connectionsFor = useMemo(() => {
    const byServer = new Map<number, McpConnectionRef[]>();
    for (const config of appConfigs) {
      const list = byServer.get(config.serverId) ?? [];
      list.push(config.connection);
      byServer.set(config.serverId, list);
    }
    return (s: McpServer): McpConnectionRef[] => [
      s.connection,
      ...(byServer.get(s.id) ?? []),
    ];
  }, [appConfigs]);

  return (
    <div className="space-y-6">
      {showPlaintextBanner && <OauthPlaintextStorageAlert />}
      <PluginsStats
        servers={servers}
        connectionsFor={connectionsFor}
        toolsByServer={toolsByServer}
        statusByServer={statusByServer}
        consentsMap={consentsMap}
        isLoading={isServersLoading}
      />
      {isServersLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border">
              <CardHeader className="p-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((s) => {
            const catalogEntry = s.catalogSlug
              ? entryBySlug.get(s.catalogSlug)
              : undefined;
            const { needsSetup, setupIncomplete } = connectionSetupState(
              s,
              catalogEntry,
              catalogQuery.isLoading,
            );
            // Still-loading, unreachable, or unauthorized configurations
            // have no tool list; the card shows a placeholder instead of
            // a misleading zero.
            const tools = pluginToolSummary(
              connectionsFor(s),
              toolsByServer,
              statusByServer,
              consentsMap,
            );
            return (
              <PluginSummaryCard
                key={s.id}
                server={s}
                iconUrl={catalogEntry?.iconUrl}
                needsSetup={needsSetup}
                setupLocked={setupIncomplete}
                switchLocked={pluginSwitchLocked(s, setupIncomplete)}
                toolCount={tools.toolCount}
                enabledToolCount={tools.enabledToolCount}
                discoveryFailed={tools.discoveryFailed}
                feedback={feedbackFor(s)}
                isConnecting={connectingKey === mcpConnectionKey(s.connection)}
                connectDisabled={connectingKey !== null}
                onConnect={onConnect}
                onToggleEnabled={toggleEnabled}
                onOpen={(serverId) =>
                  navigate({
                    to: "/plugins/$serverId",
                    params: { serverId },
                  })
                }
              />
            );
          })}
          {servers.length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground">
              No plugins added yet.
            </div>
          )}
        </div>
      )}
      <AddPluginDialog
        open={addDialogOpen}
        onOpenChange={onAddDialogOpenChange}
        onServerCreated={onServerCreated}
      />
    </div>
  );
}
