import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMcp } from "@/hooks/useMcp";
import { AddPluginDialog, useOauthStorageEncrypted } from "./AddPluginDialog";
import { OauthPlaintextStorageAlert } from "./OauthPlaintextStorageAlert";
import { PluginSummaryCard } from "./PluginSummaryCard";
import { PluginsStats } from "./PluginsStats";
import { usePluginConnect } from "./usePluginConnect";

export function PluginsList({
  addDialogOpen,
  onAddDialogOpenChange,
}: {
  addDialogOpen: boolean;
  onAddDialogOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { servers, toolsByServer, consentsMap, isLoading, toggleEnabled } =
    useMcp();
  const { connectingServerId, feedbackFor, onServerCreated, onConnect } =
    usePluginConnect();

  const oauthStorageEncrypted = useOauthStorageEncrypted();

  const hasOauthServer = useMemo(
    () => (servers || []).some((s) => s.transport === "http" && s.oauthEnabled),
    [servers],
  );
  const showPlaintextBanner = oauthStorageEncrypted === false && hasOauthServer;

  // Unconnected or still-loading servers have no tool list yet; the
  // card shows a placeholder instead of a misleading zero.
  const toolCountFor = (serverId: number): number | null =>
    toolsByServer[serverId] ? toolsByServer[serverId].length : null;

  const enabledToolCountFor = (serverId: number): number | null =>
    toolsByServer[serverId]
      ? toolsByServer[serverId].filter(
          (t) => consentsMap[`${serverId}:${t.name}`] !== "denied",
        ).length
      : null;

  return (
    <div className="space-y-6">
      {showPlaintextBanner && <OauthPlaintextStorageAlert />}
      <PluginsStats
        servers={servers}
        toolsByServer={toolsByServer}
        consentsMap={consentsMap}
        isLoading={isLoading}
      />
      {isLoading ? (
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
          {servers.map((s) => (
            <PluginSummaryCard
              key={s.id}
              server={s}
              toolCount={toolCountFor(s.id)}
              enabledToolCount={enabledToolCountFor(s.id)}
              feedback={feedbackFor(s)}
              isConnecting={connectingServerId === s.id}
              onConnect={onConnect}
              onToggleEnabled={toggleEnabled}
              onOpen={(serverId) =>
                navigate({
                  to: "/plugins/$serverId",
                  params: { serverId },
                })
              }
            />
          ))}
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
