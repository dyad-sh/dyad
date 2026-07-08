import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { McpServer } from "@/ipc/types";

export type ConnectFeedback = {
  serverId: number;
  kind: "discovery_failed" | "unauthorized" | "other";
  message: string;
};

export function PluginSummaryCard({
  server: s,
  toolCount,
  enabledToolCount,
  feedback,
  isConnecting,
  onConnect,
  onToggleEnabled,
  onOpen,
}: {
  server: McpServer;
  toolCount: number | null;
  enabledToolCount: number | null;
  feedback: ConnectFeedback | null;
  isConnecting: boolean;
  onConnect: (serverId: number) => void;
  onToggleEnabled: (serverId: number, currentEnabled: boolean) => void;
  onOpen: (serverId: number) => void;
}) {
  return (
    <Card
      data-testid="plugin-card"
      className="relative transition-all hover:shadow-md border-border cursor-pointer"
      onClick={() => onOpen(s.id)}
    >
      <CardHeader className="p-4">
        <CardTitle className="text-lg font-medium mb-1 flex items-center gap-2 min-w-0">
          <span className="truncate">{s.name}</span>
          {feedback ? (
            <span className="text-xs font-medium px-2 py-1 rounded-full text-red-600 bg-red-50 border border-red-500/50 dark:bg-red-900/30 dark:text-red-300 shrink-0">
              {feedback.kind === "unauthorized"
                ? "Needs auth"
                : "Connection error"}
            </span>
          ) : s.oauthEnabled ? (
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
                s.oauthConnected
                  ? "text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300 border border-green-500/50"
                  : "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-500/50"
              }`}
            >
              OAuth: {s.oauthConnected ? "connected" : "not connected"}
            </span>
          ) : null}
        </CardTitle>
        <div className="text-xs text-muted-foreground truncate">
          {s.transport}
          {s.url ? ` · ${s.url}` : ""}
          {s.command ? ` · ${s.command}` : ""}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {toolCount === null
              ? "— tools"
              : enabledToolCount !== null && enabledToolCount < toolCount
                ? `${enabledToolCount} of ${toolCount} tools enabled`
                : `${toolCount} tool${toolCount === 1 ? "" : "s"}`}
          </span>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {s.oauthEnabled && !s.oauthConnected && (
                <Button
                  size="sm"
                  onClick={() => onConnect(s.id)}
                  disabled={isConnecting}
                >
                  {isConnecting ? "Connecting…" : "Connect"}
                </Button>
              )}
              <Label
                htmlFor={`plugin-enabled-${s.id}`}
                className="text-xs text-muted-foreground font-normal"
              >
                Enabled
              </Label>
              <Switch
                id={`plugin-enabled-${s.id}`}
                aria-label={`Toggle ${s.name}`}
                checked={!!s.enabled}
                onCheckedChange={() => onToggleEnabled(s.id, !!s.enabled)}
              />
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
