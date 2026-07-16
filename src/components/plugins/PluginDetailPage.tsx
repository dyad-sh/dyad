import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { useMcp } from "@/hooks/useMcp";
import type { McpToolConsent } from "@/ipc/types";
import { KeyValueEditor, arrayToJsonObject } from "./KeyValueEditor";
import type { ConnectFeedback } from "./PluginSummaryCard";
import { usePluginConnect } from "./usePluginConnect";

// Keyed on the full kind union so adding a feedback kind forces a
// title here instead of silently reusing another kind's.
const FEEDBACK_TITLES: Record<ConnectFeedback["kind"], string> = {
  unauthorized: "Server requires authentication",
  discovery_failed: "Server doesn't support OAuth",
};

export function PluginDetailPage({ serverId }: { serverId: number }) {
  const navigate = useNavigate();
  const {
    servers,
    toolsByServer,
    statusByServer,
    consentsMap,
    isServersLoading,
    toggleEnabled,
    deleteServer,
    setToolConsent: updateToolConsent,
    updateServer,
    isUpdatingServer,
  } = useMcp();
  const {
    connectingServerId,
    disconnectingServerId,
    feedbackFor,
    onConnect,
    onDisconnect,
    onEnableOAuthAndRetry,
    onDisableOAuthAndRetry,
  } = usePluginConnect();

  const s = servers.find((srv) => srv.id === serverId);

  // Unknown id (deleted elsewhere, bad deep link) lands back on the
  // plugins list once the server query has resolved. Gated on the
  // servers query alone: it is a fast local read, while tool
  // discovery can take seconds and has no bearing on whether the
  // server exists.
  useEffect(() => {
    if (!isServersLoading && !s) {
      navigate({ to: "/plugins" });
    }
  }, [isServersLoading, s, navigate]);

  if (!s) {
    return null;
  }

  // Only successful discovery lands in toolsByServer, so an absent
  // entry means pending or failed, not an empty server.
  const discoveredTools = toolsByServer[s.id];
  const tools = discoveredTools ?? [];
  const feedback = feedbackFor(s);

  const onSetToolConsent = async (
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => {
    await updateToolConsent(s.id, toolName, consent);
  };

  const onDelete = async () => {
    await deleteServer(s.id);
    navigate({ to: "/plugins" });
  };

  return (
    <div className="w-full min-h-screen px-8 py-4" data-testid="plugin-detail">
      <div className="max-w-5xl pb-12">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate({ to: "/plugins" })}
        >
          <ArrowLeft size={16} />
          All Plugins
        </Button>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <span className="truncate">{s.name}</span>
                {s.oauthEnabled && (
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
                      s.oauthConnected
                        ? "text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300 border border-green-500/50"
                        : "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-500/50"
                    }`}
                  >
                    OAuth: {s.oauthConnected ? "connected" : "not connected"}
                  </span>
                )}
              </h1>
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {s.transport}
                {s.url ? ` · ${s.url}` : ""}
                {s.command ? ` · ${s.command}` : ""}
                {Array.isArray(s.args) && s.args.length
                  ? ` · ${s.args.join(" ")}`
                  : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {s.oauthEnabled && !s.oauthConnected && (
                // Only one OAuth flow can run at a time (shared
                // connect slot), so Connect is blocked while any
                // server is connecting; the label only spins for this
                // server's own flow.
                <Button
                  variant="default"
                  onClick={() => onConnect(s.id)}
                  disabled={connectingServerId !== null}
                >
                  {connectingServerId === s.id ? "Connecting…" : "Connect"}
                </Button>
              )}
              {s.oauthEnabled && s.oauthConnected && (
                <Button
                  variant="outline"
                  onClick={() => onDisconnect(s.id)}
                  disabled={disconnectingServerId === s.id}
                >
                  {disconnectingServerId === s.id
                    ? "Disconnecting…"
                    : "Disconnect"}
                </Button>
              )}
              <Switch
                aria-label={`Enabled toggle for ${s.name}`}
                checked={!!s.enabled}
                onCheckedChange={() => toggleEnabled(s.id, !!s.enabled)}
              />
              <DeleteConfirmationDialog
                itemName={s.name}
                itemType="Plugin"
                onDelete={onDelete}
                trigger={
                  <span className={buttonVariants({ variant: "outline" })}>
                    Delete
                  </span>
                }
              />
            </div>
          </div>

          {feedback && (
            <div className="mt-4">
              <Alert variant="destructive">
                <AlertTitle>{FEEDBACK_TITLES[feedback.kind]}</AlertTitle>
                <AlertDescription className="gap-2">
                  <span>{feedback.message}</span>
                  {feedback.kind === "unauthorized" && (
                    <Button
                      size="sm"
                      onClick={() => onEnableOAuthAndRetry(s.id)}
                      disabled={isUpdatingServer || connectingServerId !== null}
                    >
                      Enable OAuth & retry
                    </Button>
                  )}
                  {feedback.kind === "discovery_failed" && (
                    <Button
                      size="sm"
                      onClick={() => onDisableOAuthAndRetry(s.id)}
                      disabled={isUpdatingServer || connectingServerId !== null}
                    >
                      Disable OAuth & retry
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {s.transport === "stdio" && (
            <div className="mt-6">
              <div className="text-sm font-medium mb-2">
                Environment Variables
              </div>
              <KeyValueEditor
                id={s.id}
                json={s.envJson}
                disabled={!s.enabled}
                isSaving={isUpdatingServer}
                onSave={async (pairs) => {
                  await updateServer({
                    id: s.id,
                    envJson: arrayToJsonObject(pairs),
                  });
                }}
              />
            </div>
          )}
          {s.transport === "http" && (
            <div className="mt-6">
              <div className="text-sm font-medium mb-2">Headers</div>
              <KeyValueEditor
                id={s.id}
                json={s.headersJson}
                disabled={!s.enabled}
                isSaving={isUpdatingServer}
                itemLabel="Header"
                onSave={async (pairs) => {
                  await updateServer({
                    id: s.id,
                    headersJson: arrayToJsonObject(pairs),
                  });
                }}
              />
            </div>
          )}

          <div className="mt-6">
            <div className="text-sm font-medium mb-2">Tools</div>
            <div className="space-y-2">
              {tools.map((t) => (
                <div key={t.name} className="border rounded p-2">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-sm truncate">{t.name}</div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={consentsMap[`${s.id}:${t.name}`] || "ask"}
                        onValueChange={(v) => {
                          // The mutation already shows an error toast.
                          onSetToolConsent(
                            t.name,
                            v as McpToolConsent["consent"],
                          ).catch(() => {});
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ask">Ask</SelectItem>
                          <SelectItem value="always">Always allow</SelectItem>
                          <SelectItem value="denied">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {t.description && (
                    <div className="mt-1 text-xs max-w-[500px] text-muted-foreground truncate">
                      {t.description}
                    </div>
                  )}
                </div>
              ))}
              {tools.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  {discoveredTools
                    ? "No tools discovered."
                    : statusByServer[s.id] === "unauthorized"
                      ? "Tools will be listed once the server is connected."
                      : statusByServer[s.id] === "error"
                        ? "Tool discovery failed."
                        : "Discovering tools…"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
