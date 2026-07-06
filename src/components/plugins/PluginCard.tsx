import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { McpServer, McpTool, McpToolConsent } from "@/ipc/types";
import { KeyValueEditor, arrayToJsonObject } from "./KeyValueEditor";

export type ConnectFeedback = {
  serverId: number;
  kind: "discovery_failed" | "unauthorized" | "other";
  message: string;
};

export function PluginCard({
  server: s,
  tools,
  consents,
  feedback,
  isConnecting,
  isDisconnecting,
  isStartingOAuth,
  isUpdatingServer,
  onConnect,
  onDisconnect,
  onToggleEnabled,
  onDelete,
  onUpdateEnvJson,
  onUpdateHeadersJson,
  onSetToolConsent,
  onEnableOAuthAndRetry,
  onDisableOAuthAndRetry,
}: {
  server: McpServer;
  tools: McpTool[];
  consents: Record<string, McpToolConsent["consent"]>;
  feedback: ConnectFeedback | null;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isStartingOAuth: boolean;
  isUpdatingServer: boolean;
  onConnect: (serverId: number) => void;
  onDisconnect: (serverId: number) => void;
  onToggleEnabled: (serverId: number, currentEnabled: boolean) => void;
  onDelete: (serverId: number) => void;
  onUpdateEnvJson: (
    serverId: number,
    envJson: Record<string, string>,
  ) => Promise<void>;
  onUpdateHeadersJson: (
    serverId: number,
    headersJson: Record<string, string>,
  ) => Promise<void>;
  onSetToolConsent: (
    serverId: number,
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => void;
  onEnableOAuthAndRetry: (serverId: number) => void;
  onDisableOAuthAndRetry: (serverId: number) => void;
}) {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium flex items-center gap-2">
            {s.name}
            {s.oauthEnabled && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  s.oauthConnected
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                }`}
              >
                OAuth: {s.oauthConnected ? "connected" : "not connected"}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {s.transport}
            {s.url ? ` · ${s.url}` : ""}
            {s.command ? ` · ${s.command}` : ""}
            {Array.isArray(s.args) && s.args.length
              ? ` · ${s.args.join(" ")}`
              : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.oauthEnabled && !s.oauthConnected && (
            <Button
              variant="default"
              onClick={() => onConnect(s.id)}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </Button>
          )}
          {s.oauthEnabled && s.oauthConnected && (
            <Button
              variant="outline"
              onClick={() => onDisconnect(s.id)}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
          <Switch
            aria-label={`Toggle ${s.name}`}
            checked={!!s.enabled}
            onCheckedChange={() => onToggleEnabled(s.id, !!s.enabled)}
          />
          <Button variant="outline" onClick={() => onDelete(s.id)}>
            Delete
          </Button>
        </div>
      </div>
      {s.transport === "stdio" && (
        <div className="mt-3">
          <div className="text-sm font-medium mb-2">Environment Variables</div>
          <KeyValueEditor
            id={s.id}
            json={s.envJson}
            disabled={!s.enabled}
            isSaving={isUpdatingServer}
            onSave={async (pairs) => {
              await onUpdateEnvJson(s.id, arrayToJsonObject(pairs));
            }}
          />
        </div>
      )}
      {feedback && (
        <div className="mt-3">
          <Alert variant="destructive">
            <AlertTitle>
              {feedback.kind === "unauthorized"
                ? "Server requires authentication"
                : feedback.kind === "discovery_failed"
                  ? "Server doesn't support OAuth"
                  : "Connection failed"}
            </AlertTitle>
            <AlertDescription className="gap-2">
              <span>{feedback.message}</span>
              {feedback.kind === "unauthorized" && (
                <Button
                  size="sm"
                  onClick={() => onEnableOAuthAndRetry(s.id)}
                  disabled={isUpdatingServer || isStartingOAuth}
                >
                  Enable OAuth & retry
                </Button>
              )}
              {feedback.kind === "discovery_failed" && (
                <Button
                  size="sm"
                  onClick={() => onDisableOAuthAndRetry(s.id)}
                  disabled={isUpdatingServer}
                >
                  Disable OAuth & retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}
      {s.transport === "http" && (
        <div className="mt-3">
          <div className="text-sm font-medium mb-2">Headers</div>
          <KeyValueEditor
            id={s.id}
            json={s.headersJson}
            disabled={!s.enabled}
            isSaving={isUpdatingServer}
            itemLabel="Header"
            onSave={async (pairs) => {
              await onUpdateHeadersJson(s.id, arrayToJsonObject(pairs));
            }}
          />
        </div>
      )}
      <div className="mt-3 space-y-2">
        {tools.map((t) => (
          <div key={t.name} className="border rounded p-2">
            <div className="flex items-center gap-4">
              <div className="font-mono text-sm truncate">{t.name}</div>
              <div className="flex items-center gap-2">
                <Select
                  value={consents[`${s.id}:${t.name}`] || "ask"}
                  onValueChange={(v) =>
                    onSetToolConsent(
                      s.id,
                      t.name,
                      v as McpToolConsent["consent"],
                    )
                  }
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
            No tools discovered.
          </div>
        )}
      </div>
    </div>
  );
}
