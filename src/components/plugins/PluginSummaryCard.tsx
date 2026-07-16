import { ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { McpServer } from "@/ipc/types";
import type { ConnectFeedback } from "./usePluginConnect";

export function PluginSummaryCard({
  server: s,
  toolCount,
  enabledToolCount,
  discoveryFailed,
  feedback,
  isConnecting,
  connectDisabled,
  onConnect,
  onToggleEnabled,
  onOpen,
}: {
  server: McpServer;
  toolCount: number | null;
  enabledToolCount: number | null;
  /** Discovery settled without a tool list (unreachable or unauthorized). */
  discoveryFailed: boolean;
  feedback: ConnectFeedback | null;
  /** This card's own OAuth flow is in flight (drives the label). */
  isConnecting: boolean;
  /**
   * Any server's OAuth flow is in flight. Connects share a single
   * slot, so starting a second flow is blocked, not just this card's.
   */
  connectDisabled: boolean;
  onConnect: (serverId: number) => void;
  onToggleEnabled: (serverId: number, currentEnabled: boolean) => void;
  onOpen: (serverId: number) => void;
}) {
  return (
    <Card
      data-testid="plugin-card"
      className="relative transition-all hover:shadow-md border-border"
    >
      {/* Overlay behind the controls: the whole card opens the detail
          page while Connect and the switch stay independent controls. */}
      <button
        type="button"
        aria-label={`Open ${s.name}`}
        className="absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(s.id)}
      />
      <CardHeader className="p-4">
        <CardTitle className="text-lg font-medium mb-1 flex items-center gap-2 min-w-0">
          <span className="truncate">{s.name}</span>
          {s.catalogSlug && (
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100 inline-flex items-center gap-1 shrink-0">
              <Sparkles className="w-3 h-3" />
              Catalog
            </span>
          )}
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
            {toolCount !== null
              ? enabledToolCount !== null && enabledToolCount < toolCount
                ? `${enabledToolCount} of ${toolCount} tools enabled`
                : `${toolCount} tool${toolCount === 1 ? "" : "s"}`
              : discoveryFailed
                ? "tools unavailable"
                : "— tools"}
          </span>
          <div className="flex items-center gap-2">
            <div className="relative z-10 flex items-center gap-2">
              {s.oauthEnabled && !s.oauthConnected && (
                <Button
                  size="sm"
                  onClick={() => onConnect(s.id)}
                  disabled={connectDisabled}
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
                aria-label={`Enabled toggle for ${s.name}`}
                checked={!!s.enabled}
                onCheckedChange={() => onToggleEnabled(s.id, !!s.enabled)}
              />
            </div>
            <ChevronRight
              aria-hidden="true"
              className="w-4 h-4 text-muted-foreground shrink-0"
            />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
